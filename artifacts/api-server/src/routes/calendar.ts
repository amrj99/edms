import { Router } from "express";
import { db } from "@workspace/db";
import {
  meetingsTable, meetingActionItemsTable, tasksTable,
  usersTable, projectsTable,
} from "@workspace/db";
import { eq, and, gte, lte, or, inArray } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";

const router = Router();

router.get("/events", requireAuth, async (req, res): Promise<void> => {
  const { start, end } = req.query;

  const now = new Date();
  const startDate = start ? new Date(start as string) : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = end ? new Date(end as string) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const user = req.user!;
  const userId = user.id;

  try {
    // Tenant isolation: scope meetings to user's org via project membership
    let orgMeetingFilter;
    if (!isSysAdmin(user) && user.organizationId) {
      const orgProjects = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.organizationId, user.organizationId));
      const orgProjectIds = orgProjects.map(p => p.id);
      orgMeetingFilter = orgProjectIds.length > 0
        ? or(
            inArray(meetingsTable.projectId, orgProjectIds),
            eq(meetingsTable.organizationId, user.organizationId),
          )
        : eq(meetingsTable.organizationId, user.organizationId);
    }

    const [meetings, tasks, actionItems] = await Promise.all([
      db.select({
        id: meetingsTable.id,
        title: meetingsTable.title,
        meetingDate: meetingsTable.meetingDate,
        duration: meetingsTable.duration,
        status: meetingsTable.status,
        location: meetingsTable.location,
        projectId: meetingsTable.projectId,
      })
        .from(meetingsTable)
        .where(and(
          gte(meetingsTable.meetingDate, startDate),
          lte(meetingsTable.meetingDate, endDate),
          orgMeetingFilter,
        )),

      db.select({
        id: tasksTable.id,
        title: tasksTable.title,
        dueDate: tasksTable.dueDate,
        status: tasksTable.status,
        priority: tasksTable.priority,
        projectId: tasksTable.projectId,
        assignedToId: tasksTable.assignedToId,
      })
        .from(tasksTable)
        .where(and(
          gte(tasksTable.dueDate, startDate),
          lte(tasksTable.dueDate, endDate),
          eq(tasksTable.assignedToId, userId),
        )),

      db.select({
        id: meetingActionItemsTable.id,
        title: meetingActionItemsTable.title,
        dueDate: meetingActionItemsTable.dueDate,
        status: meetingActionItemsTable.status,
        assignedToId: meetingActionItemsTable.assignedToId,
        meetingId: meetingActionItemsTable.meetingId,
      })
        .from(meetingActionItemsTable)
        .where(and(
          gte(meetingActionItemsTable.dueDate, startDate),
          lte(meetingActionItemsTable.dueDate, endDate),
          eq(meetingActionItemsTable.assignedToId, userId),
        )),
    ]);

    const projectIds = [
      ...new Set([
        ...meetings.map(m => m.projectId),
        ...tasks.map(t => t.projectId),
      ].filter(Boolean) as number[]),
    ];

    let projectMap: Record<number, string> = {};
    if (projectIds.length) {
      const ps = await db.select({ id: projectsTable.id, name: projectsTable.name, code: projectsTable.code })
        .from(projectsTable);
      projectMap = Object.fromEntries(ps.map(p => [p.id, `${p.code} – ${p.name}`]));
    }

    const events = [
      ...meetings.map(m => ({
        id: `meeting-${m.id}`,
        type: "meeting" as const,
        title: m.title,
        date: m.meetingDate,
        duration: m.duration,
        status: m.status,
        url: "/meetings",
        projectName: m.projectId ? projectMap[m.projectId] : undefined,
        meta: m.location ? `📍 ${m.location}` : undefined,
      })),
      ...tasks.map(t => ({
        id: `task-${t.id}`,
        type: "task" as const,
        title: t.title,
        date: t.dueDate,
        status: t.status,
        priority: t.priority,
        url: "/tasks",
        projectName: t.projectId ? projectMap[t.projectId] : undefined,
      })),
      ...actionItems.map(a => ({
        id: `action-${a.id}`,
        type: "action_item" as const,
        title: a.title,
        date: a.dueDate,
        status: a.status,
        url: "/action-items",
      })),
    ];

    res.json({ events });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load calendar events" });
  }
});

export default router;
