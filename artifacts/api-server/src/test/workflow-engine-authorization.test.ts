/**
 * workflow-engine-authorization.test.ts
 *
 * Security Regression Suite — Workflow Advance/Reject Authorization (C1)
 *
 * Previously, POST /workflow-engine/instances/:id/advance and .../reject only
 * required requireAuth — ANY authenticated user in the org could advance or
 * reject ANY workflow instance regardless of wf_template_stages.responsibleUserId
 * or responsibleRole.
 *
 * This suite verifies:
 *   1. A user who is neither the stage's responsibleUserId nor holds the
 *      stage's responsibleRole (or higher) is denied (403) on advance/reject.
 *   2. The stage's responsibleUserId can advance/reject.
 *   3. A user whose effective role is >= the stage's responsibleRole can
 *      advance/reject (even if not the specific responsibleUserId).
 *   4. admin/system_owner can override on a stage they are not assigned to,
 *      and this is recorded in the audit log as workflow_admin_override_*.
 *   5. A stage with neither responsibleUserId nor responsibleRole can only be
 *      acted on by admin/system_owner (with audit log).
 *   6. POST /templates/:id/stages and PUT .../stages/:stageId reject an
 *      invalid (non-AppRole) responsibleRole with 400.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import {
  documentsTable,
  wfTemplatesTable,
  wfTemplateStagesTable,
  wfInstancesTable,
  auditLogsTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

let org: { id: number };
let project: { id: number };
let admin: { id: number; organizationId: number | null };
let assignedUser: { id: number; organizationId: number | null };   // responsibleUserId on stage 1
let outsider: { id: number; organizationId: number | null };       // member, not assigned, not enough role
let dcRoleHolder: { id: number; organizationId: number | null };    // document_controller, matches stage 2 responsibleRole

let templateId: number;
let stage1Id: number; // responsibleUserId = assignedUser, responsibleRole = null
let stage2Id: number; // responsibleRole = "document_controller", responsibleUserId = null
let stage3Id: number; // responsibleRole = null, responsibleUserId = null (admin-only)

const db = getTestDb();

beforeAll(async () => {
  await truncateAllTables();

  org = await createOrg({ name: "Workflow Org", code: "WFORG" });
  project = await createProject({ organizationId: org.id, name: "Workflow Project", code: "WFP001" });

  // requireModule("workflow_engine") fails closed without an org_config row.
  await db.insert(orgConfigTable).values({
    organizationId: org.id,
    modules: { workflow_engine: true },
  });

  admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@wf.test" });
  assignedUser = await createUser({ organizationId: org.id, role: "member", email: "assigned@wf.test" });
  outsider = await createUser({ organizationId: org.id, role: "member", email: "outsider@wf.test" });
  dcRoleHolder = await createUser({ organizationId: org.id, role: "document_controller", email: "dc@wf.test" });

  const [tpl] = await db.insert(wfTemplatesTable).values({
    organizationId: org.id,
    name: "Test Approval Workflow",
    documentType: "test-doc",
    description: "Workflow for authorization tests",
    isActive: true,
    createdById: admin.id,
  }).returning();
  templateId = tpl.id;

  const stages = await db.insert(wfTemplateStagesTable).values([
    { templateId, stageOrder: 1, name: "Assigned User Stage", responsibleRole: null, responsibleUserId: assignedUser.id, isTerminal: false },
    { templateId, stageOrder: 2, name: "DC Role Stage",       responsibleRole: "document_controller", responsibleUserId: null, isTerminal: false },
    { templateId, stageOrder: 3, name: "Unassigned Terminal Stage", responsibleRole: null, responsibleUserId: null, isTerminal: true },
  ]).returning();
  stage1Id = stages[0].id;
  stage2Id = stages[1].id;
  stage3Id = stages[2].id;
});

afterAll(async () => {
  await truncateAllTables();
});

/** Creates a document + active wf_instance currently sitting at `stageId`. */
async function createInstanceAtStage(stageId: number, docNumber: string) {
  const [doc] = await db.insert(documentsTable).values({
    organizationId: org.id,
    projectId: project.id,
    createdById: admin.id,
    documentNumber: docNumber,
    title: `Doc ${docNumber}`,
    revision: "A",
    status: "under_review",
  }).returning();

  const [inst] = await db.insert(wfInstancesTable).values({
    organizationId: org.id,
    projectId: project.id,
    documentId: doc.id,
    templateId,
    currentStageId: stageId,
    status: "active",
    initiatedById: admin.id,
  }).returning();

  return { doc, inst };
}

describe("POST /workflow-engine/instances/:id/advance — authorization (C1)", () => {
  it("denies a user who is neither the assigned user nor holds the responsible role", async () => {
    const { inst } = await createInstanceAtStage(stage1Id, "DOC-ADV-001");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("member", outsider.id, org.id))
      .send({ comment: "trying to advance without permission" });

    expect(res.status).toBe(403);

    const [refreshed] = await db.select().from(wfInstancesTable).where(eq(wfInstancesTable.id, inst.id));
    expect(refreshed.currentStageId).toBe(stage1Id);
    expect(refreshed.status).toBe("active");
  });

  it("allows the stage's responsibleUserId to advance", async () => {
    const { inst } = await createInstanceAtStage(stage1Id, "DOC-ADV-002");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("member", assignedUser.id, org.id))
      .send({ comment: "approved by assigned user" });

    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(stage2Id);
  });

  it("allows a user whose effective role matches the stage's responsibleRole", async () => {
    const { inst } = await createInstanceAtStage(stage2Id, "DOC-ADV-003");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("document_controller", dcRoleHolder.id, org.id))
      .send({ comment: "approved by document_controller" });

    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(stage3Id);
  });

  it("denies a member-role user on a DC-responsible stage", async () => {
    const { inst } = await createInstanceAtStage(stage2Id, "DOC-ADV-004");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("member", outsider.id, org.id))
      .send({ comment: "trying to skip the line" });

    expect(res.status).toBe(403);
  });

  it("denies everyone except admin/system_owner on a stage with no responsible user/role", async () => {
    const { inst } = await createInstanceAtStage(stage3Id, "DOC-ADV-005");

    const deniedRes = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("document_controller", dcRoleHolder.id, org.id))
      .send({ comment: "no one is assigned" });
    expect(deniedRes.status).toBe(403);
  });

  it("allows admin override on an unassigned stage and writes an audit log entry", async () => {
    const { inst } = await createInstanceAtStage(stage3Id, "DOC-ADV-006");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/advance`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ comment: "admin override completes the workflow" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");

    const logs = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.action, "workflow_admin_override_advance"),
        eq(auditLogsTable.entityId, inst.id),
        eq(auditLogsTable.entityType, "wf_instance"),
      ));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].userId).toBe(admin.id);
  });

  it("allows admin to advance a stage where admin is also the assigned user without logging an override", async () => {
    const { inst } = await createInstanceAtStage(stage1Id, "DOC-ADV-007");

    // Reassign stage 1's responsibleUserId to admin for this test
    await db.update(wfTemplateStagesTable).set({ responsibleUserId: admin.id }).where(eq(wfTemplateStagesTable.id, stage1Id));
    try {
      const res = await api()
        .post(`/api/workflow-engine/instances/${inst.id}/advance`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ comment: "admin acting as the assigned approver" });

      expect(res.status).toBe(200);

      const logs = await db.select().from(auditLogsTable)
        .where(and(
          eq(auditLogsTable.action, "workflow_admin_override_advance"),
          eq(auditLogsTable.entityId, inst.id),
          eq(auditLogsTable.entityType, "wf_instance"),
        ));
      expect(logs.length).toBe(0);
    } finally {
      await db.update(wfTemplateStagesTable).set({ responsibleUserId: assignedUser.id }).where(eq(wfTemplateStagesTable.id, stage1Id));
    }
  });
});

describe("POST /workflow-engine/instances/:id/reject — authorization (C1)", () => {
  it("denies a user who is neither the assigned user nor holds the responsible role", async () => {
    const { inst } = await createInstanceAtStage(stage1Id, "DOC-REJ-001");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/reject`)
      .set(authHeader("member", outsider.id, org.id))
      .send({ comment: "trying to reject without permission", action: "rejected" });

    expect(res.status).toBe(403);

    const [refreshed] = await db.select().from(wfInstancesTable).where(eq(wfInstancesTable.id, inst.id));
    expect(refreshed.status).toBe("active");
  });

  it("allows the stage's responsibleUserId to reject", async () => {
    const { inst } = await createInstanceAtStage(stage1Id, "DOC-REJ-002");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/reject`)
      .set(authHeader("member", assignedUser.id, org.id))
      .send({ comment: "rejected by assigned user", action: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
  });

  it("allows admin override on an unassigned stage and writes an audit log entry", async () => {
    const { inst } = await createInstanceAtStage(stage3Id, "DOC-REJ-003");

    const res = await api()
      .post(`/api/workflow-engine/instances/${inst.id}/reject`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ comment: "admin override cancels the workflow", action: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const logs = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.action, "workflow_admin_override_reject"),
        eq(auditLogsTable.entityId, inst.id),
        eq(auditLogsTable.entityType, "wf_instance"),
      ));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].userId).toBe(admin.id);
  });
});

describe("Stage responsibleRole validation", () => {
  it("rejects an invalid responsibleRole on stage create (POST /templates/:id/stages)", async () => {
    const res = await api()
      .post(`/api/workflow-engine/templates/${templateId}/stages`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "Invalid Role Stage", responsibleRole: "Finance", stageOrder: 4, isTerminal: false });

    expect(res.status).toBe(400);
  });

  it("accepts a valid AppRole for responsibleRole on stage create", async () => {
    const res = await api()
      .post(`/api/workflow-engine/templates/${templateId}/stages`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "Valid Role Stage", responsibleRole: "project_manager", stageOrder: 5, isTerminal: false });

    expect(res.status).toBe(201);
    expect(res.body.responsibleRole).toBe("project_manager");
  });

  it("rejects an invalid responsibleRole on stage update (PUT /templates/:id/stages/:stageId)", async () => {
    const res = await api()
      .put(`/api/workflow-engine/templates/${templateId}/stages/${stage2Id}`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ responsibleRole: "Manager" });

    expect(res.status).toBe(400);
  });
});
