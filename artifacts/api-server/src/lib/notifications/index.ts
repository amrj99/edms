/**
 * Centralized Notification Service
 *
 * Event-driven, role-aware notification dispatcher.
 * Currently supports email (via Resend). Designed so in-app and
 * other channels can be added per-event without touching route code.
 *
 * Usage:
 *   import { dispatchNotification } from "../lib/notifications/index.js";
 *   await dispatchNotification({ event: "document_uploaded", ... });
 */

import { db } from "@workspace/db";
import { userPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NotificationPrefs } from "@workspace/db";

// ─── Event Registry ────────────────────────────────────────────────────────────
export type NotificationEvent =
  | "document_uploaded"
  | "document_approved"
  | "document_rejected"
  | "correspondence_received"
  | "meeting_created"
  | "action_item_assigned"
  | "task_assigned"
  | "itr_submitted"
  | "ncr_submitted"
  | "noc_submitted"
  | "workflow_stage_reached"
  | "welcome"
  | "password_reset";

// ─── Recipient ─────────────────────────────────────────────────────────────────
export interface NotificationRecipient {
  userId?: number;
  email: string;
  name?: string;
}

// ─── Preference Check ──────────────────────────────────────────────────────────
/**
 * Returns true if the user has email enabled for the given event.
 * Defaults to true when no preference record exists (opt-out model).
 */
export async function isEmailEnabledForUser(userId: number, event: NotificationEvent): Promise<boolean> {
  try {
    const [row] = await db
      .select({ notificationPrefs: userPreferencesTable.notificationPrefs })
      .from(userPreferencesTable)
      .where(eq(userPreferencesTable.userId, userId))
      .limit(1);

    const prefs = row?.notificationPrefs as NotificationPrefs | undefined;
    if (!prefs || prefs[event] === undefined) return true;
    return prefs[event]?.email !== false;
  } catch {
    return true; // fail-open: never silently drop notifications due to a pref lookup error
  }
}

// ─── Core Dispatcher ──────────────────────────────────────────────────────────
/**
 * dispatchNotification — the single entry point for all notification events.
 *
 * @param event         The notification event type
 * @param recipients    Resolved list of recipients (with optional userId for pref check)
 * @param sendEmail     Async function that fires the actual email; receives the filtered to[] list
 *
 * Only recipients who have email enabled for `event` will be included in the
 * sendEmail call.  External recipients (no userId) are always included.
 */
export async function dispatchNotification(opts: {
  event: NotificationEvent;
  recipients: NotificationRecipient[];
  sendEmail: (toEmails: string[]) => Promise<any>;
}): Promise<void> {
  const { event, recipients, sendEmail } = opts;

  // Filter recipients by preference — external (no userId) always pass through
  const eligible: string[] = [];
  for (const r of recipients) {
    const allowed = r.userId ? await isEmailEnabledForUser(r.userId, event) : true;
    if (allowed && r.email) eligible.push(r.email);
  }

  if (eligible.length === 0) return;

  await sendEmail(eligible).catch((err: any) =>
    console.error(`[notifications] email dispatch failed for event "${event}":`, err?.message ?? err),
  );
}
