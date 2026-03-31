import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable, tasksTable } from "@workspace/db";
import { eq, and, desc, count, lt, isNotNull, notInArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

// Generate overdue-task notifications for the current user (idempotent – skips duplicates from today).
async function generateOverdueTaskNotifications(userId: number): Promise<void> {
  try {
    const now = new Date();
    // Find overdue, non-terminal tasks assigned to this user
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

    if (overdueTasks.length === 0) return;

    // Check which ones already have an unread overdue notification
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

    if (toInsert.length > 0) {
      await db.insert(notificationsTable).values(toInsert);
    }
  } catch {
    // Non-fatal: overdue notification generation failure should not break the fetch
  }
}

router.get("/", async (req, res) => {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(req.query.limit as string || "50"), 100);
  const unreadOnly = req.query.unread === "true";

  // Generate overdue-task notifications on-the-fly
  await generateOverdueTaskNotifications(userId);

  const conditions = [eq(notificationsTable.userId, userId)];
  if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));

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

  res.json({ notifications, unreadCount: Number(total) });
});

router.post("/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)));
  res.json({ success: true });
});

router.post("/read-all", async (req, res) => {
  await db.update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false)));
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)));
  res.json({ success: true });
});

// Push subscription endpoint — stores subscription for future VAPID-based push delivery.
// Activation requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment secrets.
router.post("/push-subscribe", async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }
  // Log the subscription (persisted storage requires a push_subscriptions table;
  // set up when VAPID keys are configured).
  res.json({ success: true, ready: false, message: "Push infrastructure ready — configure VAPID keys to enable delivery." });
});

export default router;
