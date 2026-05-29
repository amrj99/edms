import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable, projectsTable, notificationsTable } from "@workspace/db";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { requireOrgScope } from "../lib/org-scope.js";
import { sendTaskAssignedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { emitToUser } from "../lib/socket.js";
import { triggerSkillEvent } from "../lib/skill-engine.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';
import { TenantIsolationError } from '../lib/errors.js';

const router = Router();

async function enrichTasks(tasks: (typeof tasksTable.$inferSelect)[], callerOrgId?: number) {
  if (!tasks.length) return [];

  // Collect only the user/project IDs referenced by these tasks (avoids cross-org leakage)
  const userIds = [...new Set([
    ...tasks.map(t => t.assignedToId).filter(Boolean) as number[],
    ...tasks.map(t => t.createdById).filter(Boolean) as number[],
  ])];
  const projectIds = [...new Set(tasks.map(t => t.projectId).filter(Boolean) as number[])];

  const { inArray: drizzleInArray } = await import("drizzle-orm");

  const users = userIds.length > 0
    ? await db.select().from(usersTable).where(drizzleInArray(usersTable.id, userIds))
    : [];
  const projects = projectIds.length > 0
    ? await db.select().from(projectsTable).where(drizzleInArray(projectsTable.id, projectIds))
    : [];

  const userMap = new Map(users.map(u => [u.id, u]));
  const projectMap = new Map(projects.map(p => [p.id, p]));

  return tasks.map(t => ({
    ...t,
    assignedToName: t.assignedToId ? (userMap.get(t.assignedToId) ? `${userMap.get(t.assignedToId)!.firstName} ${userMap.get(t.assignedToId)!.lastName}` : undefined) : undefined,
    createdByName: t.createdById ? (userMap.get(t.createdById) ? `${userMap.get(t.createdById)!.firstName} ${userMap.get(t.createdById)!.lastName}` : undefined) : undefined,
    projectName: t.projectId ? projectMap.get(t.projectId)?.name : undefined,
  }));
}

router.get("/", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const user = req.user!;
  const { projectId, status, assignedToMe } = req.query;

  // Build a scoped query using the direct organization_id column when available,
  // with a fallback to project membership for legacy rows (null organization_id).
  let tasks;
  if (!isSysAdmin(user) && user.organizationId) {
    const orgId = user.organizationId;

    // Legacy rows have no organization_id — scope them via project membership
    const orgProjects = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, orgId));
    const orgProjectIds = orgProjects.map(p => p.id);

    tasks = await db.select().from(tasksTable)
      .where(
        or(
          // New rows: direct org column
          eq(tasksTable.organizationId, orgId),
          // Legacy rows: scoped by project
          and(
            isNull(tasksTable.organizationId),
            orgProjectIds.length > 0
              ? (await import("drizzle-orm")).inArray(tasksTable.projectId, orgProjectIds)
              : eq(tasksTable.id, -1),
          ),
          // Tasks with no project and no org (personal tasks created by this user)
          and(
            isNull(tasksTable.organizationId),
            isNull(tasksTable.projectId),
            eq(tasksTable.createdById, user.id),
          ),
        )
      )
      .orderBy(desc(tasksTable.updatedAt));
  } else {
    tasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));
  }

  if (projectId) tasks = tasks.filter(t => t.projectId === parseInt(projectId as string));
  if (status) tasks = tasks.filter(t => t.status === status);
  if (assignedToMe === "true") tasks = tasks.filter(t => t.assignedToId === user.id);

  const enriched = await enrichTasks(tasks);
  res.json({ tasks: enriched, total: enriched.length });
});

router.post("/", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const { title, description, priority, assignedToId, projectId, dueDate } = req.body;
  const effectiveAssignedToId = assignedToId || req.user!.id;
  const [task] = await db.insert(tasksTable).values({
    title, description, priority,
    assignedToId: effectiveAssignedToId,
    createdById: req.user!.id,
    projectId: projectId || null,
    organizationId: req.user!.organizationId ?? null,
    dueDate: dueDate ? new Date(dueDate) : undefined,
    sourceType: "manual",
  }).returning();

  // Notify the assignee (if assigned to someone other than the creator)
  if (effectiveAssignedToId && effectiveAssignedToId !== req.user!.id) {
    try {
      const [creator] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, req.user!.id));
      const creatorName = creator ? `${creator.firstName} ${creator.lastName}`.trim() : "Someone";
      const [notification] = await db.insert(notificationsTable).values({
        userId: assignedToId,
        type: "task_assigned" as const,
        title: `Task assigned: ${title}`,
        message: `${creatorName} assigned you a task: "${title}"${dueDate ? ` (due ${new Date(dueDate).toLocaleDateString()})` : ""}`,
        projectId: projectId || null,
        entityType: "task",
        entityId: task.id,
        actionUrl: `/tasks`,
      }).returning();
      emitToUser(assignedToId, "notification:new", notification);

      // Email the assignee
      const [assignee] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, assignedToId)).limit(1);
      const [project] = projectId
        ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
        : [null];
      if (assignee?.email) {
        dispatchNotification({
          event: "task_assigned",
          recipients: [{ userId: assignedToId, email: assignee.email, name: `${assignee.firstName} ${assignee.lastName}`.trim() }],
          sendEmail: (to) => sendTaskAssignedEmail({
            to: to[0],
            assigneeName: `${assignee.firstName} ${assignee.lastName}`.trim(),
            assignerName: creatorName,
            taskTitle: title,
            description,
            priority,
            dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : null,
            projectName: project?.name ?? null,
            taskLink: `${process.env.APP_URL ?? ""}/tasks`,
          }),
        }).catch(() => {});
      }
    } catch (_) {}
  }

  const enriched = await enrichTasks([task]);
  res.status(201).json(enriched[0]);
});

router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const user = req.user!;
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
  if (!tasks[0]) { res.status(404).json({ error: "Not Found" }); return; }

  // Tenant isolation: non-sysAdmin users can only access tasks within their org
  if (!isSysAdmin(user) && user.organizationId) {
    const task = tasks[0];
    const belongsToOrg = task.organizationId === user.organizationId;
    // Legacy tasks (no organizationId) — verify via project membership
    if (!belongsToOrg) {
      if (task.projectId) {
        const { inArray: drizzleInArray } = await import("drizzle-orm");
        const orgProjects = await db.select({ id: projectsTable.id })
          .from(projectsTable)
          .where(eq(projectsTable.organizationId, user.organizationId));
        const orgProjectIds = orgProjects.map(p => p.id);
        if (!orgProjectIds.includes(task.projectId)) {
          throw new TenantIsolationError({
            route: req.path, method: req.method,
            userId: user.id, userOrgId: user.organizationId,
            attemptedResourceType: "task", attemptedResourceId: id,
            taskProjectId: task.projectId,
          });
        }
      } else if (task.createdById !== user.id && task.assignedToId !== user.id) {
        throw new TenantIsolationError({
          route: req.path, method: req.method,
          userId: user.id, userOrgId: user.organizationId,
          attemptedResourceType: "task", attemptedResourceId: id,
          reason: "personal_task_not_owned",
        });
      }
    }
  }

  const enriched = await enrichTasks(tasks);
  res.json(enriched[0]);
});

router.put("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const user = req.user!;
  const { title, description, status, priority, assignedToId, dueDate } = req.body;

  // Fetch old state to detect changes + tenant isolation check
  const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
  if (!before) { res.status(404).json({ error: "Not Found" }); return; }

  // Tenant isolation: verify the task belongs to the user's org
  if (!isSysAdmin(user) && user.organizationId) {
    const belongsToOrg = before.organizationId === user.organizationId;
    if (!belongsToOrg) {
      if (before.projectId) {
        const orgProjects = await db.select({ id: projectsTable.id })
          .from(projectsTable)
          .where(eq(projectsTable.organizationId, user.organizationId));
        const orgProjectIds = orgProjects.map(p => p.id);
        if (!orgProjectIds.includes(before.projectId)) {
          throw new TenantIsolationError({
            route: req.path, method: req.method,
            userId: user.id, userOrgId: user.organizationId,
            attemptedResourceType: "task", attemptedResourceId: id,
            taskProjectId: before.projectId,
          });
        }
      } else if (before.createdById !== user.id && before.assignedToId !== user.id) {
        throw new TenantIsolationError({
          route: req.path, method: req.method,
          userId: user.id, userOrgId: user.organizationId,
          attemptedResourceType: "task", attemptedResourceId: id,
          reason: "personal_task_not_owned",
        });
      }
    }
  }

  const completedAt = status === "completed" ? new Date() : undefined;

  const [task] = await db.update(tasksTable)
    .set({ title, description, status, priority, assignedToId, dueDate: dueDate ? new Date(dueDate) : undefined, completedAt, updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();

  if (!task) { res.status(404).json({ error: "Not Found" }); return; }

  try {
    const actorId = req.user!.id;

    // Notify new assignee when task is reassigned
    if (assignedToId && before && assignedToId !== before.assignedToId && assignedToId !== actorId) {
      const [actor] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
      const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";
      const [reassignNotif] = await db.insert(notificationsTable).values({
        userId: assignedToId,
        type: "task_assigned" as const,
        title: `Task assigned: ${task.title}`,
        message: `${actorName} assigned you a task: "${task.title}"${task.dueDate ? ` (due ${task.dueDate.toLocaleDateString()})` : ""}`,
        projectId: task.projectId || null,
        entityType: "task",
        entityId: task.id,
        actionUrl: "/tasks",
      }).returning();
      emitToUser(assignedToId, "notification:new", reassignNotif);

      const [assignee] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, assignedToId)).limit(1);
      const [project] = task.projectId
        ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId)).limit(1)
        : [null];
      if (assignee?.email) {
        dispatchNotification({
          event: "task_assigned",
          recipients: [{ userId: assignedToId, email: assignee.email, name: `${assignee.firstName} ${assignee.lastName}`.trim() }],
          sendEmail: (to) => sendTaskAssignedEmail({
            to: to[0],
            assigneeName: `${assignee.firstName} ${assignee.lastName}`.trim(),
            assignerName: actorName,
            taskTitle: task.title,
            priority: task.priority,
            dueDate: task.dueDate ? task.dueDate.toLocaleDateString() : null,
            projectName: project?.name ?? null,
            taskLink: `${process.env.APP_URL ?? ""}/tasks`,
          }),
        }).catch(() => {});
      }
    }

    // Notify task creator when status changes (by someone else)
    if (status && before && status !== before.status && task.createdById && task.createdById !== actorId) {
      const statusLabel: Record<string, string> = { completed: "Completed", in_progress: "In Progress", pending: "Pending", cancelled: "Cancelled" };
      const [actor] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
      const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";
      const [statusNotif] = await db.insert(notificationsTable).values({
        userId: task.createdById,
        type: "task_status_updated" as const,
        title: `Task status updated: ${task.title}`,
        message: `${actorName} changed the status of "${task.title}" to ${statusLabel[status] ?? status}`,
        projectId: task.projectId || null,
        entityType: "task",
        entityId: task.id,
        actionUrl: "/tasks",
      }).returning();
      emitToUser(task.createdById, "notification:new", statusNotif);
    }
  } catch (_) {}

  // Fire skill event for task_completed trigger (fire-and-forget)
  if (status === "completed" && task.projectId && req.user?.organizationId) {
    triggerSkillEvent("task_completed", {
      taskId:         task.id,
      projectId:      task.projectId,
      organizationId: req.user.organizationId,
    }).catch(() => {});
  }

  const enriched = await enrichTasks([task]);
  res.json(enriched[0]);
});

export default router;
