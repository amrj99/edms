/**
 * notification-db.ts — DEBT-010: narrow, pool-backed DB handle for the
 * notification subsystem ONLY.
 *
 * Why this exists (and why it is NOT a general `poolDb` export):
 *   dispatchNotification() interleaves DB reads (prefs/settings) → an AWAITED
 *   network email → DB writes (delivery logs). It therefore MUST run OUTSIDE the
 *   request's tenant transaction (never hold a connection across email I/O). Its
 *   three tables are infrastructure/preference tables, NOT tenant-isolated
 *   business data, and are ALWAYS queried with an explicit user/org filter:
 *     • org_notification_settings — per-(org,event) enable flag   (WHERE organization_id = … AND event_key = …)
 *     • user_preferences          — per-user notification prefs    (WHERE user_id = …)
 *     • notification_logs         — delivery audit                 (INSERT with explicit organization_id/recipient_user_id)
 *   None of the three is a Row-Level-Security table (see lib/rls-init.ts).
 *
 * CONTRACT (enforced by test/tenant-notificationdb-guard.test.ts):
 *   • Import/use `notificationDb` ONLY inside lib/notifications/**.
 *   • NEVER query a tenant RLS table through it (documents, projects, tasks,
 *     correspondence, transmittals, notifications, rules, metadata_fields,
 *     document_revisions/files, inspection/ncr/noc records). Those stay on the
 *     fail-closed `db` proxy inside withTenant().
 *
 * This is a deliberate, audited platform seam — not an escape hatch for ordinary
 * tenant work.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pool,
  userPreferencesTable,
  orgNotificationSettingsTable,
  notificationLogsTable,
} from "@workspace/db";

export const notificationDb = drizzle(pool, {
  schema: { userPreferencesTable, orgNotificationSettingsTable, notificationLogsTable },
});
