/**
 * Centralized Notification Service
 *
 * Three-tier preference hierarchy:
 *   1. Mandatory events — bypass all checks (auth, delegation created/revoked)
 *   2. Org settings — org admin enables/disables per event + configures thresholds
 *   3. User preferences — user opts in/out within what the org allows
 *
 * Correspondence delivery (correspondence.delivered) is always mandatory —
 * it is the delivery mechanism itself, not a notification preference.
 */

import { db } from "@workspace/db";
import {
  userPreferencesTable,
  orgNotificationSettingsTable,
  notificationLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { NotificationPrefs } from "@workspace/db";

// ─── Event Registry ────────────────────────────────────────────────────────────
export type NotificationEvent =
  // Auth — mandatory
  | "auth.password_reset"
  | "auth.account_invited"
  // Governance — mandatory (delegation created/revoked) or default-on
  | "governance.delegation_created"
  | "governance.delegation_revoked"
  | "governance.delegation_expiry"
  | "governance.role_override_created"
  | "governance.role_override_revoked"
  // Workflow
  | "workflow.stage_assigned"
  | "workflow.approved"
  | "workflow.rejected"
  | "workflow.stuck"
  // SLA
  | "sla.due_soon"
  | "sla.breached"
  | "sla.escalated"
  // Transmittal
  | "transmittal.issued"
  // Correspondence — delivered is mandatory direct delivery
  | "correspondence.delivered"
  | "correspondence.broadcast"
  | "correspondence.unread_reminder"
  | "correspondence.no_response"
  | "correspondence.escalated"
  // Document
  | "document.archived"
  | "document.obsolete"
  // Legacy keys (kept for backward compat with existing callers)
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

// Mandatory events bypass all preference checks
const MANDATORY_EVENTS = new Set<NotificationEvent>([
  "auth.password_reset",
  "auth.account_invited",
  "governance.delegation_created",
  "governance.delegation_revoked",
  "correspondence.delivered",
  "password_reset",
  "welcome",
]);

// ─── Recipient ─────────────────────────────────────────────────────────────────
export interface NotificationRecipient {
  userId?: number;
  email: string;
  name?: string;
}

// ─── Org-level preference check ────────────────────────────────────────────────
async function isEventEnabledForOrg(organizationId: number, event: NotificationEvent): Promise<boolean> {
  try {
    const [row] = await db
      .select({ enabled: orgNotificationSettingsTable.enabled })
      .from(orgNotificationSettingsTable)
      .where(and(
        eq(orgNotificationSettingsTable.organizationId, organizationId),
        eq(orgNotificationSettingsTable.eventKey, event),
      ))
      .limit(1);

    // If no row exists, fall back to default (most events are default-on)
    return row?.enabled ?? true;
  } catch {
    return true;
  }
}

// ─── User-level preference check ──────────────────────────────────────────────
async function isEmailEnabledForUser(userId: number, event: NotificationEvent): Promise<boolean> {
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
    return true;
  }
}

// ─── Notification Log ──────────────────────────────────────────────────────────
async function writeLog(opts: {
  eventKey: string;
  recipientUserId?: number;
  recipientEmail?: string;
  organizationId?: number;
  entityType?: string;
  entityId?: number;
  status: "sent" | "skipped" | "failed" | "suppressed";
  errorMessage?: string;
  providerId?: string;
}) {
  try {
    await db.insert(notificationLogsTable).values({
      eventKey: opts.eventKey,
      recipientUserId: opts.recipientUserId,
      recipientEmail: opts.recipientEmail,
      organizationId: opts.organizationId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      channel: "email",
      status: opts.status,
      errorMessage: opts.errorMessage,
      providerId: opts.providerId,
    });
  } catch (_) {
    // Log writes must never throw — silent failure acceptable
  }
}

// ─── Core Dispatcher ──────────────────────────────────────────────────────────
/**
 * dispatchNotification — the single entry point for all notification events.
 *
 * Preference evaluation order (for non-mandatory events):
 *   1. Org-level settings (org admin can disable)
 *   2. User-level prefs (user can opt out within org bounds)
 *
 * Mandatory events and correspondence.delivered bypass all checks.
 */
export async function dispatchNotification(opts: {
  event: NotificationEvent;
  mandatory?: boolean;
  recipients: NotificationRecipient[];
  sendEmail: (toEmails: string[]) => Promise<any>;
  organizationId?: number;
  entityType?: string;
  entityId?: number;
}): Promise<void> {
  const { event, recipients, sendEmail, organizationId, entityType, entityId } = opts;
  const isMandatory = opts.mandatory === true || MANDATORY_EVENTS.has(event);

  // Check org-level setting (skipped for mandatory events)
  if (!isMandatory && organizationId) {
    const orgAllows = await isEventEnabledForOrg(organizationId, event);
    if (!orgAllows) {
      for (const r of recipients) {
        await writeLog({ eventKey: event, recipientUserId: r.userId, recipientEmail: r.email, organizationId, entityType, entityId, status: "suppressed", errorMessage: "disabled by org settings" });
      }
      return;
    }
  }

  // Filter recipients by user preference (skipped for mandatory events)
  const eligible: string[] = [];
  for (const r of recipients) {
    if (!r.email) continue;
    const allowed = isMandatory ? true : (r.userId ? await isEmailEnabledForUser(r.userId, event) : true);
    if (allowed) {
      eligible.push(r.email);
    } else {
      await writeLog({ eventKey: event, recipientUserId: r.userId, recipientEmail: r.email, organizationId, entityType, entityId, status: "suppressed", errorMessage: "opted out by user" });
    }
  }

  if (eligible.length === 0) return;

  try {
    const result = await sendEmail(eligible);
    for (const email of eligible) {
      const r = recipients.find(rec => rec.email === email);
      await writeLog({ eventKey: event, recipientUserId: r?.userId, recipientEmail: email, organizationId, entityType, entityId, status: "sent", providerId: result?.id });
    }
  } catch (err: any) {
    console.error(`[notifications] email dispatch failed for event "${event}":`, err?.message ?? err);
    for (const email of eligible) {
      const r = recipients.find(rec => rec.email === email);
      await writeLog({ eventKey: event, recipientUserId: r?.userId, recipientEmail: email, organizationId, entityType, entityId, status: "failed", errorMessage: err?.message });
    }
  }
}

// ─── Legacy export (backward compat) ──────────────────────────────────────────
export async function isEmailEnabledForUserLegacy(userId: number, event: NotificationEvent): Promise<boolean> {
  return isEmailEnabledForUser(userId, event);
}
