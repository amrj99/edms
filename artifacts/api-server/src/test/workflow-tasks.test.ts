/**
 * workflow-tasks.test.ts
 *
 * Integration tests for the Workflow Tasks "Reflection" feature:
 *   - Task creation when a workflow stage is reached (responsibleUserId only)
 *   - Role-only stage → no task created
 *   - Deduplication: at most 1 active task per workflow instance
 *   - Advance: current task completed + new task for next stage
 *   - Workflow completion: final task completed, no new task
 *   - Reject/cancel: task cancelled
 *   - Return: task cancelled + new task for the returned stage
 *   - PUT /api/tasks/:id with status blocked for workflow tasks (403)
 *   - enriched task includes actionUrl pointing to the document
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { db } from "@workspace/db";
import {
  organizationsTable, usersTable, projectsTable, documentsTable,
  wfTemplatesTable, wfTemplateStagesTable, wfInstancesTable, wfInstanceTransitionsTable,
  tasksTable, orgConfigTable, auditLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { signToken } from "../lib/auth.js";
import app from "../app.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const FAKE_HASH = "$2b$12$testplaceholder00000000000000000000000000000000000000000";

interface Ctx {
  orgId: number;
  adminId: number;
  reviewerId: number;
  projectId: number;
  documentId: number;
  tplId: number;
  stage1Id: number;  // responsibleUserId = reviewerId
  stage2Id: number;  // role-only (responsibleRole = "reviewer")
  adminToken: string;
  reviewerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const [org] = await db.insert(organizationsTable).values({
    name: "WfTask Test Org",
    type: "consultant",
    subscriptionTier: "professional",
  }).returning();

  const [admin] = await db.insert(usersTable).values({
    email: `wf-admin-${Date.now()}@test.local`,
    firstName: "Workflow", lastName: "Admin",
    passwordHash: FAKE_HASH, role: "admin",
    organizationId: org.id, isActive: true, mustChangePassword: false,
  }).returning();

  const [reviewer] = await db.insert(usersTable).values({
    email: `wf-reviewer-${Date.now()}@test.local`,
    firstName: "Workflow", lastName: "Reviewer",
    passwordHash: FAKE_HASH, role: "reviewer",
    organizationId: org.id, isActive: true, mustChangePassword: false,
  }).returning();

  const [proj] = await db.insert(projectsTable).values({
    name: "WfTask Test Project",
    code: `WFTP-${Date.now()}`,
    organizationId: org.id, status: "active",
  }).returning();

  const [doc] = await db.insert(documentsTable).values({
    organizationId: org.id,
    projectId: proj.id,
    createdById: admin.id,
    documentNumber: `WFTST-${Date.now()}`,
    title: "Workflow Task Test Document",
    revision: "A",
    status: "draft",
  }).returning();

  const [tpl] = await db.insert(wfTemplatesTable).values({
    organizationId: org.id,
    name: "WfTask Test Template",
    documentType: "General",
    isActive: true,
    createdById: admin.id,
  }).returning();

  // Stage 1: specific user (reviewer) — should create a Task
  const [stage1] = await db.insert(wfTemplateStagesTable).values({
    templateId: tpl.id,
    name: "Reviewer Stage",
    stageOrder: 1,
    responsibleUserId: reviewer.id,
    responsibleRole: null,
    isTerminal: false,
  }).returning();

  // Stage 2: role-only — should NOT create a Task
  const [stage2] = await db.insert(wfTemplateStagesTable).values({
    templateId: tpl.id,
    name: "Role Only Stage",
    stageOrder: 2,
    responsibleUserId: null,
    responsibleRole: "reviewer",
    isTerminal: true,
  }).returning();

  // Enable workflow_engine module (backfillOrgConfig at app startup may have already inserted this row)
  const allModules = { dashboard: true, deliverables: true, registers: true, notifications: true, workflow_engine: true };
  await db.insert(orgConfigTable).values({ organizationId: org.id, modules: allModules })
    .onConflictDoUpdate({ target: orgConfigTable.organizationId, set: { modules: allModules } });

  const adminToken = signToken({ id: admin.id, email: admin.email, role: admin.role, organizationId: org.id });
  const reviewerToken = signToken({ id: reviewer.id, email: reviewer.email, role: reviewer.role, organizationId: org.id });

  return {
    orgId: org.id, adminId: admin.id, reviewerId: reviewer.id,
    projectId: proj.id, documentId: doc.id,
    tplId: tpl.id, stage1Id: stage1.id, stage2Id: stage2.id,
    adminToken, reviewerToken,
  };
}

async function cleanCtx(ctx: Ctx) {
  // Best-effort cleanup — the test DB is disposable; orphan rows are acceptable.
  // We clean what we can in dependency order and swallow FK errors on user/org deletion
  // (notification_logs, audit_logs, etc. created by the workflow routes reference users).
  try { await db.delete(tasksTable).where(eq(tasksTable.organizationId, ctx.orgId)); } catch (_) {}
  const instances = await db.select({ id: wfInstancesTable.id })
    .from(wfInstancesTable).where(eq(wfInstancesTable.organizationId, ctx.orgId));
  for (const inst of instances) {
    try { await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, inst.id)); } catch (_) {}
  }
  try { await db.delete(wfInstancesTable).where(eq(wfInstancesTable.organizationId, ctx.orgId)); } catch (_) {}
  try { await db.delete(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.templateId, ctx.tplId)); } catch (_) {}
  try { await db.delete(wfTemplatesTable).where(eq(wfTemplatesTable.id, ctx.tplId)); } catch (_) {}
  try { await db.delete(documentsTable).where(eq(documentsTable.id, ctx.documentId)); } catch (_) {}
  try { await db.delete(projectsTable).where(eq(projectsTable.id, ctx.projectId)); } catch (_) {}
  try { await db.delete(orgConfigTable).where(eq(orgConfigTable.organizationId, ctx.orgId)); } catch (_) {}
  // Delete audit logs and notification logs by user ID before removing users
  const { inArray: drizzleInArray } = await import("drizzle-orm");
  try { await db.delete(auditLogsTable).where(drizzleInArray(auditLogsTable.userId, [ctx.adminId, ctx.reviewerId])); } catch (_) {}
  // Attempt user deletion — may fail if other tables still reference them (acceptable)
  try { await db.delete(usersTable).where(eq(usersTable.organizationId, ctx.orgId)); } catch (_) {}
  try { await db.delete(organizationsTable).where(eq(organizationsTable.id, ctx.orgId)); } catch (_) {}
}

async function getWfTasks(orgId: number, instanceId: number) {
  return db.select().from(tasksTable)
    .where(and(
      eq(tasksTable.sourceType, "workflow"),
      eq(tasksTable.sourceId, instanceId),
      eq(tasksTable.organizationId, orgId),
    ));
}

async function startInstance(ctx: Ctx): Promise<number> {
  const res = await supertest(app)
    .post("/api/workflow-engine/instances")
    .set("Authorization", `Bearer ${ctx.adminToken}`)
    .send({ documentId: ctx.documentId, templateId: ctx.tplId, projectId: ctx.projectId });
  expect(res.status).toBe(201);
  return res.body.id;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Workflow Tasks — reflection pattern", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await buildCtx();
  });

  afterAll(async () => {
    await cleanCtx(ctx);
  });

  // ── 1. Task created on instance creation (stage 1 has responsibleUserId) ────
  it("creates a task when stage has responsibleUserId", async () => {
    const instId = await startInstance(ctx);

    const tasks = await getWfTasks(ctx.orgId, instId);
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.status).toBe("pending");
    expect(task.assignedToId).toBe(ctx.reviewerId);
    expect(task.sourceType).toBe("workflow");
    expect(task.sourceId).toBe(instId);
    expect(task.title).toContain("[Action Required]");
    expect(task.title).toContain("Reviewer Stage");

    // Cleanup this instance so it doesn't affect subsequent tests
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 2. Deduplication: only 1 active task per instance ────────────────────────
  it("maintains at most 1 active task per workflow instance", async () => {
    const instId = await startInstance(ctx);

    const tasksAfterStart = await getWfTasks(ctx.orgId, instId);
    expect(tasksAfterStart.filter(t => t.status === "pending" || t.status === "in_progress")).toHaveLength(1);

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 3. Task actionUrl points to the document ──────────────────────────────────
  it("enriched task includes actionUrl pointing to the document", async () => {
    const instId = await startInstance(ctx);

    const res = await supertest(app)
      .get("/api/tasks")
      .query({ assignedToMe: "true" })
      .set("Authorization", `Bearer ${ctx.reviewerToken}`);
    expect(res.status).toBe(200);

    const wfTask = (res.body.tasks as any[]).find(
      (t: any) => t.sourceType === "workflow" && t.sourceId === instId
    );
    expect(wfTask).toBeDefined();
    expect(wfTask.actionUrl).toBe(`/projects/${ctx.projectId}/documents/${ctx.documentId}`);

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 4. Manual status change on workflow task is blocked (403) ─────────────────
  it("returns 403 when manually changing status of a workflow task", async () => {
    const instId = await startInstance(ctx);

    const tasks = await getWfTasks(ctx.orgId, instId);
    expect(tasks).toHaveLength(1);
    const taskId = tasks[0].id;

    const res = await supertest(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ status: "completed" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("workflow_task_immutable");

    // Verify task status unchanged
    const [unchanged] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
    expect(unchanged.status).toBe("pending");

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 5. Advance → old task completed + new task for next stage ─────────────────
  it("advances: completes current task and creates new one for next stage", async () => {
    const instId = await startInstance(ctx);

    const tasksBefore = await getWfTasks(ctx.orgId, instId);
    expect(tasksBefore).toHaveLength(1);
    const firstTaskId = tasksBefore[0].id;

    // Advance (reviewer has permission on stage 1)
    const advRes = await supertest(app)
      .post(`/api/workflow-engine/instances/${instId}/advance`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ comment: "Looks good" });
    expect(advRes.status).toBe(200);

    // Old task should now be completed
    const [oldTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, firstTaskId)).limit(1);
    expect(oldTask.status).toBe("completed");

    // Stage 2 is role-only → no new task
    const allTasks = await getWfTasks(ctx.orgId, instId);
    const activeTasks = allTasks.filter(t => t.status === "pending" || t.status === "in_progress");
    expect(activeTasks).toHaveLength(0);

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 6. Role-only stage: no task created ───────────────────────────────────────
  it("does not create a task for role-only stages", async () => {
    // Create template with only a role-only stage
    const [roleTpl] = await db.insert(wfTemplatesTable).values({
      organizationId: ctx.orgId, name: "RoleOnly Tpl",
      documentType: "General", isActive: true, createdById: ctx.adminId,
    }).returning();
    const [roleStage] = await db.insert(wfTemplateStagesTable).values({
      templateId: roleTpl.id, name: "Role Stage", stageOrder: 1,
      responsibleUserId: null, responsibleRole: "reviewer", isTerminal: true,
    }).returning();

    // Need a fresh document (can't have 2 active instances on same doc+template)
    const [doc2] = await db.insert(documentsTable).values({
      organizationId: ctx.orgId, projectId: ctx.projectId, createdById: ctx.adminId,
      documentNumber: `ROLE-${Date.now()}`, title: "Role Only Doc", revision: "A", status: "draft",
    }).returning();

    const res = await supertest(app)
      .post("/api/workflow-engine/instances")
      .set("Authorization", `Bearer ${ctx.adminToken}`)
      .send({ documentId: doc2.id, templateId: roleTpl.id, projectId: ctx.projectId });
    expect(res.status).toBe(201);
    const instId = res.body.id;

    const tasks = await getWfTasks(ctx.orgId, instId);
    expect(tasks).toHaveLength(0);

    // Cleanup
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
    await db.delete(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, roleStage.id));
    await db.delete(wfTemplatesTable).where(eq(wfTemplatesTable.id, roleTpl.id));
    await db.delete(documentsTable).where(eq(documentsTable.id, doc2.id));
  });

  // ── 7. Reject → task cancelled, no new task ───────────────────────────────────
  it("reject cancels task and creates no new task", async () => {
    const instId = await startInstance(ctx);

    const tasksBefore = await getWfTasks(ctx.orgId, instId);
    const firstTaskId = tasksBefore[0].id;

    const rejRes = await supertest(app)
      .post(`/api/workflow-engine/instances/${instId}/reject`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ comment: "Not acceptable", action: "rejected" });
    expect(rejRes.status).toBe(200);

    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, firstTaskId)).limit(1);
    expect(task.status).toBe("cancelled");

    const allTasks = await getWfTasks(ctx.orgId, instId);
    const activeTasks = allTasks.filter(t => t.status === "pending" || t.status === "in_progress");
    expect(activeTasks).toHaveLength(0);

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
  });

  // ── 8. Return → task cancelled + new task for returned stage ─────────────────
  it("return cancels current task and creates new task for the returned stage", async () => {
    // Need a 2-stage template with user-specific assignments on both stages to test return
    const [tpl2] = await db.insert(wfTemplatesTable).values({
      organizationId: ctx.orgId, name: "Return Test Tpl",
      documentType: "General", isActive: true, createdById: ctx.adminId,
    }).returning();
    const [stA] = await db.insert(wfTemplateStagesTable).values({
      templateId: tpl2.id, name: "Stage A", stageOrder: 1,
      responsibleUserId: ctx.reviewerId, responsibleRole: null, isTerminal: false,
    }).returning();
    const [stB] = await db.insert(wfTemplateStagesTable).values({
      templateId: tpl2.id, name: "Stage B", stageOrder: 2,
      responsibleUserId: ctx.reviewerId, responsibleRole: null, isTerminal: true,
    }).returning();

    const [doc3] = await db.insert(documentsTable).values({
      organizationId: ctx.orgId, projectId: ctx.projectId, createdById: ctx.adminId,
      documentNumber: `RET-${Date.now()}`, title: "Return Test Doc", revision: "A", status: "draft",
    }).returning();

    const createRes = await supertest(app)
      .post("/api/workflow-engine/instances")
      .set("Authorization", `Bearer ${ctx.adminToken}`)
      .send({ documentId: doc3.id, templateId: tpl2.id, projectId: ctx.projectId });
    expect(createRes.status).toBe(201);
    const instId = createRes.body.id;

    const initialTasks = await getWfTasks(ctx.orgId, instId);
    expect(initialTasks).toHaveLength(1);
    const taskAId = initialTasks[0].id;
    expect(initialTasks[0].status).toBe("pending");

    // Advance to stage B
    const advRes = await supertest(app)
      .post(`/api/workflow-engine/instances/${instId}/advance`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ comment: "Moving to B" });
    expect(advRes.status).toBe(200);

    // Task A should be completed, task B created
    const [taskA] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskAId)).limit(1);
    expect(taskA.status).toBe("completed");

    const afterAdvance = await getWfTasks(ctx.orgId, instId);
    const activeBTasks = afterAdvance.filter(t => t.status === "pending");
    expect(activeBTasks).toHaveLength(1);
    const taskBId = activeBTasks[0].id;

    // Return from B to A
    const retRes = await supertest(app)
      .post(`/api/workflow-engine/instances/${instId}/reject`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ comment: "Send back", action: "returned" });
    expect(retRes.status).toBe(200);

    // Task B should be cancelled
    const [taskB] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskBId)).limit(1);
    expect(taskB.status).toBe("cancelled");

    // A new task for stage A should exist
    const afterReturn = await getWfTasks(ctx.orgId, instId);
    const newActiveTasks = afterReturn.filter(t => t.status === "pending");
    expect(newActiveTasks).toHaveLength(1);
    expect(newActiveTasks[0].id).not.toBe(taskBId);
    expect(newActiveTasks[0].title).toContain("Stage A");

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
    await db.delete(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.templateId, tpl2.id));
    await db.delete(wfTemplatesTable).where(eq(wfTemplatesTable.id, tpl2.id));
    await db.delete(documentsTable).where(eq(documentsTable.id, doc3.id));
  });

  // ── 9. Workflow completion → final task completed ─────────────────────────────
  it("completes the task when the workflow completes", async () => {
    // Single-stage terminal template
    const [tplFinal] = await db.insert(wfTemplatesTable).values({
      organizationId: ctx.orgId, name: "Final Stage Tpl",
      documentType: "General", isActive: true, createdById: ctx.adminId,
    }).returning();
    const [stFinal] = await db.insert(wfTemplateStagesTable).values({
      templateId: tplFinal.id, name: "Final Stage", stageOrder: 1,
      responsibleUserId: ctx.reviewerId, responsibleRole: null, isTerminal: true,
    }).returning();

    const [doc4] = await db.insert(documentsTable).values({
      organizationId: ctx.orgId, projectId: ctx.projectId, createdById: ctx.adminId,
      documentNumber: `FIN-${Date.now()}`, title: "Final Stage Doc", revision: "A", status: "draft",
    }).returning();

    const createRes = await supertest(app)
      .post("/api/workflow-engine/instances")
      .set("Authorization", `Bearer ${ctx.adminToken}`)
      .send({ documentId: doc4.id, templateId: tplFinal.id, projectId: ctx.projectId });
    expect(createRes.status).toBe(201);
    const instId = createRes.body.id;

    const tasks = await getWfTasks(ctx.orgId, instId);
    expect(tasks).toHaveLength(1);
    const taskId = tasks[0].id;

    // Advance → workflow completes (single terminal stage)
    const advRes = await supertest(app)
      .post(`/api/workflow-engine/instances/${instId}/advance`)
      .set("Authorization", `Bearer ${ctx.reviewerToken}`)
      .send({ comment: "Final approval" });
    expect(advRes.status).toBe(200);
    expect(advRes.body.status).toBe("completed");

    // Task should be completed
    const [finishedTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
    expect(finishedTask.status).toBe("completed");

    // No new active tasks
    const allTasks = await getWfTasks(ctx.orgId, instId);
    const activeTasks = allTasks.filter(t => t.status === "pending" || t.status === "in_progress");
    expect(activeTasks).toHaveLength(0);

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.sourceId, instId));
    await db.delete(wfInstanceTransitionsTable).where(eq(wfInstanceTransitionsTable.instanceId, instId));
    await db.delete(wfInstancesTable).where(eq(wfInstancesTable.id, instId));
    await db.delete(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.templateId, tplFinal.id));
    await db.delete(wfTemplatesTable).where(eq(wfTemplatesTable.id, tplFinal.id));
    await db.delete(documentsTable).where(eq(documentsTable.id, doc4.id));
  });
});
