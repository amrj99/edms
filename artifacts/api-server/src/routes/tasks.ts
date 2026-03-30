import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable, projectsTable, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";

const router = Router();

async function enrichTasks(tasks: (typeof tasksTable.$inferSelect)[]) {
  if (!tasks.length) return [];
  const users = await db.select().from(usersTable);
  const projects = await db.select().from(projectsTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  const projectMap = new Map(projects.map(p => [p.id, p]));

  return tasks.map(t => ({
    ...t,
    assignedToName: t.assignedToId ? (userMap.get(t.assignedToId) ? `${userMap.get(t.assignedToId)!.firstName} ${userMap.get(t.assignedToId)!.lastName}` : undefined) : undefined,
    createdByName: t.createdById ? (userMap.get(t.createdById) ? `${userMap.get(t.createdById)!.firstName} ${userMap.get(t.createdById)!.lastName}` : undefined) : undefined,
    projectName: t.projectId ? projectMap.get(t.projectId)?.name : undefined,
  }));
}

router.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const { projectId, status, assignedToMe } = req.query;

  let tasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));

  if (!isSysAdmin(user) && user.organizationId) {
    const orgProjects = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, user.organizationId));
    const orgProjectIds = new Set(orgProjects.map(p => p.id));
    tasks = tasks.filter(t => !t.projectId || orgProjectIds.has(t.projectId));
  }

  if (projectId) tasks = tasks.filter(t => t.projectId === parseInt(projectId as string));
  if (status) tasks = tasks.filter(t => t.status === status);
  if (assignedToMe === "true") tasks = tasks.filter(t => t.assignedToId === user.id);

  const enriched = await enrichTasks(tasks);
  res.json({ tasks: enriched, total: enriched.length });
});

router.post("/", requireAuth, async (req, res) => {
  const { title, description, priority, assignedToId, projectId, dueDate } = req.body;
  const effectiveAssignedToId = assignedToId || req.user!.id;
  const [task] = await db.insert(tasksTable).values({
    title, description, priority,
    assignedToId: effectiveAssignedToId,
    createdById: req.user!.id,
    projectId: projectId || null,
    dueDate: dueDate ? new Date(dueDate) : undefined,
    sourceType: "manual",
  }).returning();

  // Notify the assignee (if assigned to someone other than the creator)
  if (effectiveAssignedToId && effectiveAssignedToId !== req.user!.id) {
    try {
      const [creator] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, req.user!.id));
      const creatorName = creator ? `${creator.firstName} ${creator.lastName}`.trim() : "Someone";
      await db.insert(notificationsTable).values({
        userId: assignedToId,
        type: "task_assigned" as const,
        title: `Task assigned: ${title}`,
        message: `${creatorName} assigned you a task: "${title}"${dueDate ? ` (due ${new Date(dueDate).toLocaleDateString()})` : ""}`,
        projectId: projectId || null,
        entityType: "task",
        entityId: task.id,
        actionUrl: `/tasks`,
      });
    } catch (_) {}
  }

  const enriched = await enrichTasks([task]);
  res.status(201).json(enriched[0]);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
  if (!tasks[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichTasks(tasks);
  res.json(enriched[0]);
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, status, priority, assignedToId, dueDate } = req.body;

  const completedAt = status === "completed" ? new Date() : undefined;

  const [task] = await db.update(tasksTable)
    .set({ title, description, status, priority, assignedToId, dueDate: dueDate ? new Date(dueDate) : undefined, completedAt, updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();

  if (!task) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichTasks([task]);
  res.json(enriched[0]);
});

export default router;
