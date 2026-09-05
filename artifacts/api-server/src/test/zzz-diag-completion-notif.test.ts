/**
 * DIAGNOSTIC (temporary): reproduce the missing completion-notification.
 * Creator (Manager) != actor (DC) completes a correspondence-linked task via
 * PATCH /api/tasks/:id — the code should create a task_status_updated notification
 * for the creator. We assert it exists; the instrumented catch in tasks.ts logs the
 * real error if the insert fails.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { tasksTable, notificationsTable, projectMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

let orgId: number, creatorId: number, actorId: number, projectId: number, taskId: number;

beforeAll(async () => {
  await truncateAllTables();
  const org = await createOrg({ name: "Diag Org" });
  orgId = org.id;
  const creator = await createUser({ organizationId: orgId, role: "admin", email: "creator@diag.edms" });
  const actor = await createUser({ organizationId: orgId, role: "document_controller", email: "actor@diag.edms" });
  creatorId = creator.id;
  actorId = actor.id;
  const proj = await createProject({ organizationId: orgId, createdById: creatorId });
  projectId = proj.id;

  const db = getTestDb();
  await db.insert(projectMembersTable).values([
    { projectId, userId: creatorId, role: "admin" },
    { projectId, userId: actorId, role: "document_controller" },
  ]);
  const [task] = await db.insert(tasksTable).values({
    title: "[Action Required] Diag corr task",
    status: "pending",
    priority: "medium",
    assignedToId: actorId,
    createdById: creatorId,
    projectId,
    organizationId: orgId,
    sourceType: "correspondence",
    sourceId: 12345,
    assignedAt: new Date(),
  }).returning();
  taskId = task.id;
});

describe("DIAG completion notification", () => {
  it("actor completes → creator gets a task_status_updated notification", async () => {
    const res = await api()
      .patch(`/api/tasks/${taskId}`)
      .set(authHeader("document_controller", actorId, orgId, "actor@diag.edms"))
      .send({ status: "completed" });
    console.log("[DIAG] PATCH status:", res.status, "body:", JSON.stringify(res.body)?.slice(0, 200));

    const db = getTestDb();
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
    console.log("[DIAG] task.status after PATCH:", t?.status);

    const notifs = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.userId, creatorId), eq(notificationsTable.type, "task_status_updated")));
    console.log("[DIAG] creator notifications count:", notifs.length, JSON.stringify(notifs.map(n => ({ id: n.id, userId: n.userId, type: n.type, orgId: n.organizationId }))));

    expect(t?.status).toBe("completed");
    expect(notifs.length).toBe(1);
  });
});
