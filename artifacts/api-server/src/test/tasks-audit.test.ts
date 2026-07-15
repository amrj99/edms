/**
 * tasks-audit.test.ts — C-3 (Tasks Audit Logging).
 *
 * Fable C-3: the tasks mutation routes (POST / create, PUT /:id update) wrote to
 * the DB with ZERO audit logging — no trail of who created a task, changed its
 * status, or reassigned it. This closes that gap using the EXISTING audit action
 * vocabulary ("create" / "update" / "status_change") — no new taxonomy, no enum,
 * no schema change. These tests assert the audit rows are written with the right
 * action + entity + details.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { db, organizationsTable, usersTable, projectsTable, tasksTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { signToken } from "../lib/auth.js";
import { truncateAllTables } from "./helpers/index.js";
import app from "../app.js";

const FAKE_HASH = "$2b$12$testplaceholder00000000000000000000000000000000000000000";

interface Ctx { orgId: number; adminId: number; assigneeId: number; projectId: number; token: string; }

async function buildCtx(): Promise<Ctx> {
  const [org] = await db.insert(organizationsTable).values({
    name: "Task Audit Org", type: "consultant", subscriptionTier: "professional",
  }).returning();
  const [admin] = await db.insert(usersTable).values({
    email: `ta-admin-${Date.now()}@test.local`, firstName: "Task", lastName: "Admin",
    passwordHash: FAKE_HASH, role: "admin", organizationId: org.id, isActive: true, mustChangePassword: false,
  }).returning();
  const [assignee] = await db.insert(usersTable).values({
    email: `ta-assignee-${Date.now()}@test.local`, firstName: "Ass", lastName: "Ignee",
    passwordHash: FAKE_HASH, role: "member", organizationId: org.id, isActive: true, mustChangePassword: false,
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    name: "Task Audit Project", code: `TAP-${Date.now()}`, organizationId: org.id, status: "active",
  }).returning();
  const token = signToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id });
  return { orgId: org.id, adminId: admin.id, assigneeId: assignee.id, projectId: project.id, token };
}

const auditFor = (entityId: number) =>
  db.select().from(auditLogsTable).where(and(eq(auditLogsTable.entityType, "task"), eq(auditLogsTable.entityId, entityId)));

let ctx: Ctx;
beforeEach(async () => { await truncateAllTables(); ctx = await buildCtx(); });
afterEach(async () => { await truncateAllTables(); });

describe("C-3 — Tasks audit logging", () => {
  it("POST /api/tasks writes a `create` audit row for the task", async () => {
    const res = await supertest(app).post("/api/tasks")
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ title: "Audit me", priority: "high", projectId: ctx.projectId });
    expect(res.status).toBe(201);
    const taskId = res.body.id ?? res.body.task?.id;
    expect(taskId).toBeDefined();

    const logs = await auditFor(taskId);
    const createLog = logs.find(l => l.action === "create");
    expect(createLog, "a `create` audit row must exist for the new task").toBeDefined();
    expect(createLog!.userId).toBe(ctx.adminId);
    expect(createLog!.organizationId).toBe(ctx.orgId);
  });

  it("PUT /api/tasks/:id with a status change writes a `status_change` audit row (from/to)", async () => {
    const [task] = await db.insert(tasksTable).values({
      title: "T", createdById: ctx.adminId, assignedToId: ctx.adminId,
      organizationId: ctx.orgId, projectId: ctx.projectId, status: "pending", sourceType: "manual",
    }).returning();

    const res = await supertest(app).put(`/api/tasks/${task.id}`)
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ status: "completed" });
    expect(res.status).toBe(200);

    const logs = await auditFor(task.id);
    const statusLog = logs.find(l => l.action === "status_change");
    expect(statusLog, "a `status_change` audit row must exist").toBeDefined();
    const details = statusLog!.details as Record<string, unknown>;
    expect(details.statusFrom).toBe("pending");
    expect(details.statusTo).toBe("completed");
  });

  it("PUT /api/tasks/:id reassignment (no status change) writes an `update` audit row with assignedTo", async () => {
    const [task] = await db.insert(tasksTable).values({
      title: "T2", createdById: ctx.adminId, assignedToId: ctx.adminId,
      organizationId: ctx.orgId, projectId: ctx.projectId, status: "pending", sourceType: "manual",
    }).returning();

    const res = await supertest(app).put(`/api/tasks/${task.id}`)
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ assignedToId: ctx.assigneeId });
    expect(res.status).toBe(200);

    const logs = await auditFor(task.id);
    const updateLog = logs.find(l => l.action === "update");
    expect(updateLog, "an `update` audit row must exist for the reassignment").toBeDefined();
    const details = updateLog!.details as Record<string, unknown>;
    expect(details.assignedFrom).toBe(ctx.adminId);
    expect(details.assignedTo).toBe(ctx.assigneeId);
  });

  it("uses ONLY the existing action vocabulary (create/update/status_change) — no new action names", async () => {
    const res = await supertest(app).post("/api/tasks")
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ title: "Vocab", projectId: ctx.projectId });
    const taskId = res.body.id ?? res.body.task?.id;
    await supertest(app).put(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${ctx.token}`).send({ priority: "low" });
    await supertest(app).put(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${ctx.token}`).send({ status: "in_progress" });

    const logs = await auditFor(taskId);
    const actions = new Set(logs.map(l => l.action));
    for (const a of actions) expect(["create", "update", "status_change"]).toContain(a);
  });
});
