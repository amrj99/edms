/**
 * Scheduled Notifications Worker
 *
 * Polls the scheduled_notifications table every 5 minutes and fires
 * any pending jobs whose fire_at has passed.
 *
 * Handles:
 *   - governance.delegation_expiry  (48h warning before expiry)
 *   - sla.due_soon                  (X hours before due date)
 *   - sla.breached                  (due date passed without close)
 *   - correspondence.unread_reminder (unread after threshold hours)
 *   - correspondence.no_response    (no reply after threshold hours)
 *
 * New event types: add a handler below and schedule rows from the relevant
 * API route when records are created or updated.
 */

import { db } from "@workspace/db";
import {
  scheduledNotificationsTable,
  notificationLogsTable,
  usersTable,
} from "@workspace/db";
import { and, isNull, lte, eq, inArray } from "drizzle-orm";
import { sendNotificationEmail } from "../email.js";
import { APP_URL } from "../email.js";
import { dispatchNotification } from "./index.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONCURRENCY = 5;                   // jobs processed in parallel per chunk

// B-4-1: pre-fetched user shape — only the columns each handler needs
type UserRecord = { id: number; firstName: string; lastName: string; email: string };

// ─── Per-job processor ────────────────────────────────────────────────────────
//
// Self-contained: catches its own errors and always marks sentAt — even on
// failure — so Promise.allSettled never sees a rejection from this function.
// "mark sent on failure" is intentional; see comment below.

async function processJob(
  job: typeof scheduledNotificationsTable.$inferSelect,
  userMap: Map<number, UserRecord>,
): Promise<void> {
  try {
    await handleJob(job, userMap);
    await db
      .update(scheduledNotificationsTable)
      .set({ sentAt: new Date() })
      .where(eq(scheduledNotificationsTable.id, job.id));
  } catch (err: any) {
    console.error(`[scheduler] Job ${job.id} (${job.eventKey}) failed:`, err?.message ?? err);
    // Mark sent anyway to prevent infinite retry loops — log the error
    await db
      .update(scheduledNotificationsTable)
      .set({ sentAt: new Date() })
      .where(eq(scheduledNotificationsTable.id, job.id));
    try {
      await db.insert(notificationLogsTable).values({
        eventKey: job.eventKey,
        recipientUserId: job.targetUserId ?? undefined,
        recipientEmail: job.targetEmail ?? undefined,
        organizationId: job.organizationId ?? undefined,
        entityType: job.entityType ?? undefined,
        entityId: job.entityId ?? undefined,
        channel: "email",
        status: "failed",
        errorMessage: err?.message,
      });
    } catch (_) {}
  }
}

// ─── Batch processor (exported for integration tests) ─────────────────────────

export async function processBatch(): Promise<void> {
  const now = new Date();

  const pending = await db
    .select()
    .from(scheduledNotificationsTable)
    .where(
      and(
        lte(scheduledNotificationsTable.fireAt, now),
        isNull(scheduledNotificationsTable.sentAt),
        isNull(scheduledNotificationsTable.cancelledAt),
      )
    )
    .limit(50);

  if (pending.length === 0) return;

  console.info(`[scheduler] Processing ${pending.length} scheduled notification(s)`);

  // B-4-1: Batch user lookup — one query for all unique targetUserIds in the batch
  // instead of one SELECT per job inside handleJob.
  const userIds = [
    ...new Set(pending.map(j => j.targetUserId).filter((id): id is number => id != null)),
  ];
  const users = userIds.length > 0
    ? await db
        .select({
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map<number, UserRecord>(users.map(u => [u.id, u]));

  // B-4-2: Process in parallel chunks — Promise.allSettled ensures one job failure
  // does not abort the remaining jobs in the same chunk.
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await Promise.allSettled(chunk.map(job => processJob(job, userMap)));
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleJob(
  job: typeof scheduledNotificationsTable.$inferSelect,
  userMap: Map<number, UserRecord>,
): Promise<void> {
  const meta = (job.metadata ?? {}) as Record<string, unknown>;

  // B-4-1: resolve user from pre-fetched map — no per-job DB query
  const user = job.targetUserId != null ? userMap.get(job.targetUserId) : undefined;

  switch (job.eventKey) {
    case "governance.delegation_expiry": {
      if (!user) return;
      await dispatchNotification({
        event: "governance.delegation_expiry",
        mandatory: false,
        recipients: [{ userId: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }],
        organizationId: job.organizationId ?? undefined,
        entityType: job.entityType ?? undefined,
        entityId: job.entityId ?? undefined,
        sendEmail: async (emails) => sendNotificationEmail({
          to: emails[0],
          title: "Delegation Expiring Soon",
          message: `Your delegation${meta.scope ? ` (${meta.scope})` : ""} will expire ${meta.expiresAt ? `on ${new Date(meta.expiresAt as string).toLocaleDateString()}` : "soon"}. Please renew it if still required.`,
          link: `${APP_URL}/delegations`,
          linkLabel: "Manage Delegations →",
        }),
      });
      break;
    }

    case "sla.due_soon": {
      if (!user) return;
      await dispatchNotification({
        event: "sla.due_soon",
        mandatory: false,
        recipients: [{ userId: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }],
        organizationId: job.organizationId ?? undefined,
        entityType: job.entityType ?? undefined,
        entityId: job.entityId ?? undefined,
        sendEmail: async (emails) => sendNotificationEmail({
          to: emails[0],
          title: `Due Soon: ${meta.title ?? "Record"}`,
          message: `The ${job.entityType ?? "item"} "${meta.title ?? ""}" is due ${meta.dueDate ? `on ${new Date(meta.dueDate as string).toLocaleDateString()}` : "soon"}. Please take action.`,
          link: meta.link as string | undefined,
          linkLabel: "View Record →",
        }),
      });
      break;
    }

    case "sla.breached": {
      if (!user) return;
      await dispatchNotification({
        event: "sla.breached",
        mandatory: false,
        recipients: [{ userId: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }],
        organizationId: job.organizationId ?? undefined,
        entityType: job.entityType ?? undefined,
        entityId: job.entityId ?? undefined,
        sendEmail: async (emails) => sendNotificationEmail({
          to: emails[0],
          title: `SLA Breached: ${meta.title ?? "Record Overdue"}`,
          message: `The ${job.entityType ?? "item"} "${meta.title ?? ""}" is overdue. It was due on ${meta.dueDate ? new Date(meta.dueDate as string).toLocaleDateString() : "a past date"}. Immediate action is required.`,
          link: meta.link as string | undefined,
          linkLabel: "View Overdue Record →",
        }),
      });
      break;
    }

    case "correspondence.unread_reminder": {
      if (!user) return;
      await dispatchNotification({
        event: "correspondence.unread_reminder",
        mandatory: false,
        recipients: [{ userId: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }],
        organizationId: job.organizationId ?? undefined,
        entityType: "correspondence",
        entityId: job.entityId ?? undefined,
        sendEmail: async (emails) => sendNotificationEmail({
          to: emails[0],
          title: "Unread Correspondence",
          message: `You have unread correspondence: "${meta.subject ?? ""}" — it has been waiting for your attention.`,
          link: `${APP_URL}/correspondence`,
          linkLabel: "View Correspondence →",
        }),
      });
      break;
    }

    case "correspondence.no_response": {
      if (!user) return;
      await dispatchNotification({
        event: "correspondence.no_response",
        mandatory: false,
        recipients: [{ userId: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }],
        organizationId: job.organizationId ?? undefined,
        entityType: "correspondence",
        entityId: job.entityId ?? undefined,
        sendEmail: async (emails) => sendNotificationEmail({
          to: emails[0],
          title: "No Response on Correspondence",
          message: `The correspondence "${meta.subject ?? ""}" has not received a response. Please follow up.`,
          link: `${APP_URL}/correspondence`,
          linkLabel: "View Correspondence →",
        }),
      });
      break;
    }

    default:
      console.warn(`[scheduler] No handler for event key: ${job.eventKey}`);
  }
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────────────

let _started = false;

export function startNotificationScheduler() {
  if (_started) return;
  _started = true;

  console.info("[scheduler] Notification scheduler started — polling every 5 minutes");

  // Initial run shortly after startup
  setTimeout(() => processBatch().catch(err => console.error("[scheduler] Initial batch failed:", err)), 10_000);

  // Regular interval
  setInterval(() => {
    processBatch().catch(err => console.error("[scheduler] Batch failed:", err));
  }, POLL_INTERVAL_MS);
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * scheduleNotification — helper to create a scheduled notification job.
 * Call this from API routes when records with SLA dates are created/updated.
 */
export async function scheduleNotification(opts: {
  eventKey: string;
  fireAt: Date;
  targetUserId?: number;
  targetEmail?: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
  organizationId?: number;
  projectId?: number;
}) {
  try {
    await db.insert(scheduledNotificationsTable).values({
      eventKey: opts.eventKey,
      fireAt: opts.fireAt,
      targetUserId: opts.targetUserId,
      targetEmail: opts.targetEmail,
      entityType: opts.entityType,
      entityId: opts.entityId,
      metadata: opts.metadata,
      organizationId: opts.organizationId,
      projectId: opts.projectId,
    });
  } catch (err: any) {
    console.warn(`[scheduler] Failed to schedule notification "${opts.eventKey}":`, err?.message);
  }
}

/**
 * cancelScheduledNotifications — cancel pending jobs for a specific entity.
 * Call when a record is resolved, closed, or deleted.
 */
export async function cancelScheduledNotifications(opts: {
  entityType: string;
  entityId: number;
  eventKeys?: string[];
  reason?: string;
}) {
  try {
    const conditions = [
      eq(scheduledNotificationsTable.entityType, opts.entityType),
      eq(scheduledNotificationsTable.entityId, opts.entityId),
      isNull(scheduledNotificationsTable.sentAt),
      isNull(scheduledNotificationsTable.cancelledAt),
    ];
    if (opts.eventKeys?.length) {
      conditions.push(inArray(scheduledNotificationsTable.eventKey, opts.eventKeys));
    }
    await db
      .update(scheduledNotificationsTable)
      .set({ cancelledAt: new Date(), cancelReason: opts.reason ?? "entity resolved" })
      .where(and(...conditions));
  } catch (err: any) {
    console.warn(`[scheduler] Failed to cancel notifications:`, err?.message);
  }
}
