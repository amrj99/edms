import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable, projectsTable, notificationsTable, wfInstancesTable } from "@workspace/db";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { requireAuth, isSystemOwner } from "../lib/auth.js";
import { requireOrgScope } from "../lib/org-scope.js";
import { sendTaskAssignedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { emitToUser } from "../lib/socket.js";
import { dispatchSkillEventBackground } from "../lib/skill-events.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { createAuditLog } from "../lib/audit.js";
import {param, paramInt, requireInt} from '../lib/params';
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

  // For workflow tasks: resolve the document URL from the workflow instance
  const wfInstanceIds = [...new Set(
    tasks.filter(t => t.sourceType === "workflow" && t.sourceId != null).map(t => t.sourceId!)
  )];
  const wfDocMap = new Map<number, { documentId: number; projectId: number | null }>();
  if (wfInstanceIds.length > 0) {
    const instances = await db
      .select({ id: wfInstancesTable.id, documentId: wfInstancesTable.documentId, projectId: wfInstancesTable.projectId })
      .from(wfInstancesTable)
      .where(drizzleInArray(wfInstancesTable.id, wfInstanceIds));
    for (const inst of instances) {
      wfDocMap.set(inst.id, { documentId: inst.documentId, projectId: inst.projectId });
    }
  }

  return tasks.map(t => {
    let actionUrl: string | undefined;
    if (t.sourceType === "workflow" && t.sourceId != null) {
      const wfDoc = wfDocMap.get(t.sourceId);
      if (wfDoc) {
        actionUrl = wfDoc.projectId != null
          ? `/projects/${wfDoc.projectId}/documents/${wfDoc.documentId}`
          : `/documents/${wfDoc.documentId}`;
      }
    }
    return {
      ...t,
      assignedToName: t.assignedToId ? (userMap.get(t.assignedToId) ? `${userMap.get(t.assignedToId)!.firstName} ${userMap.get(t.assignedToId)!.lastName}` : undefined) : undefined,
      createdByName: t.createdById ? (userMap.get(t.createdById) ? `${userMap.get(t.createdById)!.firstName} ${userMap.get(t.createdById)!.lastName}` : undefined) : undefined,
      projectName: t.projectId ? projectMap.get(t.projectId)?.name : undefined,
      actionUrl,
    };
  });
}

router.get("/", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const user = req.user!;
  const { projectId, status, assignedToMe } = req.query;

  // Build a scoped query using the direct organization_id column when available,
  // with a fallback to project membership for legacy rows (null organization_id).
  // Scoped list read runs in a short read tx; JS filtering sits BETWEEN this and
  // the enrichment read, so enrichTasks gets its own short read tx below.
  let tasks = await tenantRead(async () => {
    if (!isSystemOwner(user) && user.organizationId) {
      const orgId = user.organizationId;

      // Legacy rows have no organization_id — scope them via project membership
      const orgProjects = await db.select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.organizationId, orgId));
      const orgProjectIds = orgProjects.map(p => p.id);

      return await db.select().from(tasksTable)
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
      return await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));
    }
  });

  if (projectId) tasks = tasks.filter(t => t.projectId === parseInt(projectId as string));
  if (status) tasks = tasks.filter(t => t.status === status);
  if (assignedToMe === "true") tasks = tasks.filter(t => t.assignedToId === user.id);

  const enriched = await tenantRead(() => enrichTasks(tasks));
  res.json({ items: enriched, total: enriched.length });
});

router.post("/", requireAuth, requireOrgScope, async (req, res, next): Promise<void> => {
  const { title, description, priority, assignedToId, projectId, dueDate } = req.body;
  const effectiveAssignedToId = assignedToId || req.user!.id;

  try {
    // Business unit-of-work: task + audit (atomic).
    const task = await withTenant(async () => {
      const [t] = await db.insert(tasksTable).values({
        title, description, priority,
        assignedToId: effectiveAssignedToId,
        createdById: req.user!.id,
        projectId: projectId || undefined,
        organizationId: req.user!.organizationId ?? undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        sourceType: "manual",
        assignedAt: effectiveAssignedToId ? new Date() : undefined,
      }).returning();
      await createAuditLog({
        userId: req.user!.id,
        organizationId: req.user!.organizationId ?? undefined,
        action: "create",
        entityType: "task",
        entityId: t.id,
        entityTitle: t.title,
        projectId: t.projectId ?? undefined,
        details: { status: t.status, priority: t.priority, assignedToId: t.assignedToId },
      });
      return t;
    });

    // Notify the assignee (best-effort; in-app in its own short tx, email after commit)
    if (effectiveAssignedToId && effectiveAssignedToId !== req.user!.id) {
      try {
        const { notification, creatorName, assignee, project } = await withTenant(async () => {
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
          const [assignee] = await db
            .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
            .from(usersTable).where(eq(usersTable.id, assignedToId)).limit(1);
          const [project] = projectId
            ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
            : [null];
          return { notification, creatorName, assignee, project };
        });
        emitToUser(assignedToId, "notification:new", notification);
        if (assignee?.email) {
          dispatchNotification({
            event: "task_assigned",
            recipients: [{ userId: assignedToId, email: assignee.email, name: `${assignee.firstName} ${assignee.lastName}`.trim() }],
            sendEmail: (to) => sendTaskAssignedEmail({
              to: to[0],
              assigneeName: `${assignee.firstName} ${assignee.lastName}`.trim(),
              assignerName: creatorName,
              taskTitle: title,
              taskDescription: description,
              priority,
              dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : null,
              projectName: project?.name ?? null,
              taskLink: `${process.env.APP_URL ?? ""}/tasks`,
            }),
          }).catch(() => {});
        }
      } catch (_) {}
    }

    const enriched = await withTenant(() => enrichTasks([task]));
    res.status(201).json(enriched[0]);
  } catch (e) { next(e); }
});

router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;

  // Task lookup + tenant-isolation checks + enrichment in ONE short read tx.
  const loaded = await tenantRead(async () => {
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    if (!tasks[0]) return { kind: "notfound" as const };

    // Tenant isolation: non-sysAdmin users can only access tasks within their org
    if (!isSystemOwner(user) && user.organizationId) {
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
    return { kind: "ok" as const, task: enriched[0] };
  });

  if (loaded.kind === "notfound") { res.status(404).json({ error: "Not Found" }); return; }
  res.json(loaded.task);
});

router.put("/:id", requireAuth, async (req, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;
  const { title, description, status, priority, assignedToId, dueDate } = req.body;

  try {
    let result: { status: number; body: unknown } | undefined;
    let task: typeof tasksTable.$inferSelect | undefined;
    let before: typeof tasksTable.$inferSelect | undefined;

    // Business unit-of-work: isolation checks + update + audit (atomic).
    await withTenant(async () => {
      const [b] = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
      if (!b) { result = { status: 404, body: { error: "Not Found" } }; return; }
      before = b;

      // Tenant isolation (throws TenantIsolationError → global handler)
      if (!isSystemOwner(user) && user.organizationId) {
        const belongsToOrg = b.organizationId === user.organizationId;
        if (!belongsToOrg) {
          if (b.projectId) {
            const orgProjects = await db.select({ id: projectsTable.id })
              .from(projectsTable)
              .where(eq(projectsTable.organizationId, user.organizationId));
            const orgProjectIds = orgProjects.map(p => p.id);
            if (!orgProjectIds.includes(b.projectId)) {
              throw new TenantIsolationError({
                route: req.path, method: req.method,
                userId: user.id, userOrgId: user.organizationId,
                attemptedResourceType: "task", attemptedResourceId: id,
                taskProjectId: b.projectId,
              });
            }
          } else if (b.createdById !== user.id && b.assignedToId !== user.id) {
            throw new TenantIsolationError({
              route: req.path, method: req.method,
              userId: user.id, userOrgId: user.organizationId,
              attemptedResourceType: "task", attemptedResourceId: id,
              reason: "personal_task_not_owned",
            });
          }
        }
      }

      // Workflow tasks: status is owned by the workflow engine, not users
      if (b.sourceType === "workflow" && status !== undefined) {
        result = { status: 403, body: { error: "workflow_task_immutable", message: "Workflow task status is managed by the workflow engine and cannot be changed manually." } };
        return;
      }

      const completedAt = status === "completed" ? new Date() : undefined;
      const now = new Date();
      const assignedAtUpdate = (assignedToId !== undefined && assignedToId !== b.assignedToId)
        ? { assignedAt: now }
        : {};

      const [t] = await db.update(tasksTable)
        .set({ title, description, status, priority, assignedToId, dueDate: dueDate ? new Date(dueDate) : undefined, completedAt, updatedAt: now, ...assignedAtUpdate })
        .where(eq(tasksTable.id, id))
        .returning();
      if (!t) { result = { status: 404, body: { error: "Not Found" } }; return; }
      task = t;

      const statusChanged = status !== undefined && status !== b.status;
      const reassigned = assignedToId !== undefined && assignedToId !== b.assignedToId;
      await createAuditLog({
        userId: user.id,
        organizationId: user.organizationId ?? undefined,
        action: statusChanged ? "status_change" : "update",
        entityType: "task",
        entityId: t.id,
        entityTitle: t.title,
        projectId: t.projectId ?? undefined,
        details: {
          ...(statusChanged ? { statusFrom: b.status, statusTo: t.status } : {}),
          ...(reassigned ? { assignedFrom: b.assignedToId, assignedTo: t.assignedToId } : {}),
        },
        beforeState: { title: b.title, status: b.status, priority: b.priority, assignedToId: b.assignedToId },
        afterState: { title: t.title, status: t.status, priority: t.priority, assignedToId: t.assignedToId },
      });
      result = { status: 200, body: null };
    });

    if (result!.status !== 200) { res.status(result!.status).json(result!.body); return; }
    const t = task!;
    const b = before!;

    // Notifications (best-effort; in-app in its own short tx, email/socket after commit)
    try {
      const actorId = req.user!.id;
      const bundle = await withTenant(async () => {
        let reassignNotif: typeof notificationsTable.$inferSelect | undefined;
        let statusNotif: typeof notificationsTable.$inferSelect | undefined;
        let actorName = "Someone";
        let assignee: { firstName: string; lastName: string; email: string } | undefined;
        let project: { name: string } | null = null;

        if (assignedToId && assignedToId !== b.assignedToId && assignedToId !== actorId) {
          const [actor] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
            .from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
          actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";
          [reassignNotif] = await db.insert(notificationsTable).values({
            userId: assignedToId,
            type: "task_assigned" as const,
            title: `Task assigned: ${t.title}`,
            message: `${actorName} assigned you a task: "${t.title}"${t.dueDate ? ` (due ${t.dueDate.toLocaleDateString()})` : ""}`,
            projectId: t.projectId || null,
            entityType: "task",
            entityId: t.id,
            actionUrl: "/tasks",
          }).returning();
          const [a] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
            .from(usersTable).where(eq(usersTable.id, assignedToId)).limit(1);
          assignee = a as any;
          const [p] = t.projectId
            ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, t.projectId)).limit(1)
            : [null];
          project = p;
        }

        if (status && status !== b.status && t.createdById && t.createdById !== actorId) {
          const statusLabel: Record<string, string> = { completed: "Completed", in_progress: "In Progress", pending: "Pending", cancelled: "Cancelled" };
          const [actor] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
            .from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
          const an = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";
          [statusNotif] = await db.insert(notificationsTable).values({
            userId: t.createdById,
            type: "task_status_updated" as const,
            title: `Task status updated: ${t.title}`,
            message: `${an} changed the status of "${t.title}" to ${statusLabel[status] ?? status}`,
            projectId: t.projectId || null,
            entityType: "task",
            entityId: t.id,
            actionUrl: "/tasks",
          }).returning();
        }
        return { reassignNotif, statusNotif, actorName, assignee, project };
      });

      if (bundle.reassignNotif) {
        emitToUser(assignedToId, "notification:new", bundle.reassignNotif);
        if (bundle.assignee?.email) {
          dispatchNotification({
            event: "task_assigned",
            recipients: [{ userId: assignedToId, email: bundle.assignee.email, name: `${bundle.assignee.firstName} ${bundle.assignee.lastName}`.trim() }],
            sendEmail: (to) => sendTaskAssignedEmail({
              to: to[0],
              assigneeName: `${bundle.assignee!.firstName} ${bundle.assignee!.lastName}`.trim(),
              assignerName: bundle.actorName,
              taskTitle: t.title,
              priority: t.priority,
              dueDate: t.dueDate ? t.dueDate.toLocaleDateString() : null,
              projectName: bundle.project?.name ?? null,
              taskLink: `${process.env.APP_URL ?? ""}/tasks`,
            }),
          }).catch(() => {});
        }
      }
      if (bundle.statusNotif) emitToUser(t.createdById!, "notification:new", bundle.statusNotif);
    } catch (_) {}

    // Skill event (task_completed) — explicit background boundary AFTER commit.
    if (status === "completed" && t.projectId && req.user?.organizationId) {
      dispatchSkillEventBackground(
        { organizationId: req.user.organizationId, userId: req.user.id },
        "task_completed",
        { taskId: t.id, projectId: t.projectId },
      );
    }

    const enriched = await withTenant(() => enrichTasks([t]));
    res.json(enriched[0]);
  } catch (e) { next(e); }
});

export default router;
