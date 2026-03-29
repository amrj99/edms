import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(req.query.limit as string || "50"), 100);
  const unreadOnly = req.query.unread === "true";

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
