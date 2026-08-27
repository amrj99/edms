import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable, tasksTable, meetingsTable, meetingAttendeesTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, lt, lte, gte, isNotNull, notInArray, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { emitToUser } from "../lib/socket.js";
import {param, paramInt, requireInt, queryIntOr} from '../lib/params';

const router = Router();
router.use(requireAuth);

// ─── Overdue task notification generation ──────────────────────────────────────
// DEBT-010 Phase D: runs inside a short write unit-of-work (the caller opens the tx
// via tenantRead). Returns the freshly inserted rows so the CALLER can emit socket
// events AFTER commit — no external I/O inside the tx. Errors propagate to the
// caller, which treats generation as best-effort (non-fatal), preserving prior behavior.
async function generateOverdueTaskNotifications(userId: number): Promise<typeof notificationsTable.$inferSelect[]> {
  const now = new Date();
  const overdueTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.assignedToId, userId),
        isNotNull(tasksTable.dueDate),
        lt(tasksTable.dueDate, now),
        notInArray(tasksTable.status, ["completed", "cancelled"]),
      )
    );

  if (overdueTasks.length === 0) return [];

  const existingOverdue = await db
    .select({ entityId: notificationsTable.entityId })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "task_overdue"),
        eq(notificationsTable.isRead, false),
      )
    );
  const alreadyNotified = new Set(existingOverdue.map(n => n.entityId));

  const toInsert = overdueTasks
    .filter(t => !alreadyNotified.has(t.id))
    .map(t => ({
      userId,
      type: "task_overdue" as const,
      title: "Overdue Task",
      message: `"${t.title}" was due on ${t.dueDate!.toLocaleDateString()} and is still open.`,
      entityId: t.id,
      entityType: "task",
      actionUrl: "/tasks",
    }));

  if (toInsert.length === 0) return [];
  return db.insert(notificationsTable).values(toInsert).returning();
}

// ─── Upcoming meeting reminder generation ─────────────────────────────────────
// Reminds users 24 hours before a meeting they are attending.
async function generateUpcomingMeetingReminders(userId: number): Promise<typeof notificationsTable.$inferSelect[]> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find meetings within next 24 hours where user is an attendee
  const attendeeRows = await db
    .select({ meetingId: meetingAttendeesTable.meetingId })
    .from(meetingAttendeesTable)
    .where(eq(meetingAttendeesTable.userId, userId));

  if (attendeeRows.length === 0) return [];
  const meetingIds = attendeeRows.map(r => r.meetingId);

  const upcomingMeetings = await db
    .select({ id: meetingsTable.id, title: meetingsTable.title, meetingDate: meetingsTable.meetingDate })
    .from(meetingsTable)
    .where(
      and(
        inArray(meetingsTable.id, meetingIds),
        gte(meetingsTable.meetingDate, now),
        lte(meetingsTable.meetingDate, in24h),
        notInArray(meetingsTable.status, ["cancelled", "completed"]),
      )
    );

  if (upcomingMeetings.length === 0) return [];

  // Deduplicate: skip meetings already reminded about (unread reminder exists)
  const existingReminders = await db
    .select({ entityId: notificationsTable.entityId })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "meeting_reminder"),
        eq(notificationsTable.isRead, false),
      )
    );
  const alreadyReminded = new Set(existingReminders.map(n => n.entityId));

  const toInsert = upcomingMeetings
    .filter(m => !alreadyReminded.has(m.id))
    .map(m => {
      const hoursAway = Math.round((m.meetingDate.getTime() - now.getTime()) / (60 * 60 * 1000));
      const timeStr = hoursAway <= 1 ? "less than 1 hour" : `${hoursAway} hours`;
      return {
        userId,
        type: "meeting_reminder" as const,
        title: `Upcoming meeting: ${m.title}`,
        message: `You have a meeting "${m.title}" starting in ${timeStr} (${m.meetingDate.toLocaleString()})`,
        entityId: m.id,
        entityType: "meeting",
        actionUrl: "/meetings",
      };
    });

  if (toInsert.length === 0) return [];
  return db.insert(notificationsTable).values(toInsert).returning();
}

// ─── GET /api/notifications ────────────────────────────────────────────────────
router.get("/", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const limit = Math.min(queryIntOr(req.query.limit, 50), 100);
  const unreadOnly = req.query.unread === "true";
  const typeFilter = req.query.type as string | undefined;

  // On-the-fly generation: each generator runs in its OWN short write UoW so a
  // failure is non-fatal (best-effort, as before). Socket emits happen AFTER commit.
  const toEmit: typeof notificationsTable.$inferSelect[] = [];
  for (const gen of [generateOverdueTaskNotifications, generateUpcomingMeetingReminders]) {
    try {
      const inserted = await tenantRead(() => gen(userId));
      toEmit.push(...inserted);
    } catch { /* non-fatal generation */ }
  }
  for (const n of toEmit) emitToUser(n.userId, "notification:new", n);

  // Read the page + unread count in one short read unit.
  const { notifications, total } = await tenantRead(async () => {
    const conditions = [eq(notificationsTable.userId, userId)];
    if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));
    if (typeFilter) conditions.push(eq(notificationsTable.type, typeFilter as any));

    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);

    const [{ total }] = await db
      .select({ total: count() })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
    return { notifications, total };
  });

  res.json({ items: notifications, unreadCount: Number(total) });
});

// ─── Mark single notification as read ─────────────────────────────────────────
router.post("/:id/read", async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  let updated: { id: number }[] = [];
  await withTenant(async () => {
    updated = await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)))
      .returning({ id: notificationsTable.id });
  });
  if (updated.length === 0) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ success: true });
});

// ─── Mark single notification as unread ───────────────────────────────────────
router.post("/:id/unread", async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  let updated: { id: number }[] = [];
  await withTenant(async () => {
    updated = await db.update(notificationsTable)
      .set({ isRead: false, readAt: null })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)))
      .returning({ id: notificationsTable.id });
  });
  if (updated.length === 0) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ success: true });
});

// ─── Mark all notifications as read ───────────────────────────────────────────
router.post("/read-all", async (req, res): Promise<void> => {
  await withTenant(async () => {
    await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false)));
  });
  res.json({ success: true });
});

// ─── Delete notification ───────────────────────────────────────────────────────
router.delete("/:id", async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  let deleted: { id: number }[] = [];
  await withTenant(async () => {
    deleted = await db.delete(notificationsTable)
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)))
      .returning({ id: notificationsTable.id });
  });
  if (deleted.length === 0) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ success: true });
});

// ─── Push subscription (VAPID) ────────────────────────────────────────────────
router.post("/push-subscribe", async (req, res): Promise<void> => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }
  res.json({ success: true, ready: false, message: "Push infrastructure ready — configure VAPID keys to enable delivery." });
});

export default router;
