import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Enable PostgreSQL Row-Level Security on sensitive org-scoped tables.
 *
 * Idempotent — safe to call on every server startup.
 *
 * Policy logic:
 *   - Row passes if organization_id IS NULL (system-wide / unscoped rows)
 *   - Row passes if the session variable app.current_org_id is '' or unset
 *     (sysadmin bypass — set by setRlsContext middleware for system_owner)
 *   - Row passes if organization_id matches the session variable
 *
 * FORCE ROW LEVEL SECURITY overrides the implicit superuser/table-owner bypass
 * so the policy applies even to the DB role the application connects with.
 *
 * The session variable is set by the setRlsContext middleware in
 * middlewares/rls-context.ts before each authenticated request.
 */

const RLS_TABLES = [
  "documents",
  "document_revisions",
  "document_files",
  "projects",
  "tasks",
  "notifications",
  "rules",
  "correspondence",
  "transmittals",
  "inspection_requests",
  "ncr_records",
  "noc_records",
  "metadata_fields",
] as const;

const POLICY_NAME = "org_isolation_policy";

export async function initRlsPolicies(): Promise<void> {
  for (const table of RLS_TABLES) {
    try {
      // Enable RLS on the table (safe if already enabled)
      await db.execute(
        sql.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      );

      // FORCE applies the policy even when the connecting role is the table owner
      await db.execute(
        sql.raw(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      );

      // Drop the policy if it exists so we can recreate it idempotently
      await db.execute(
        sql.raw(`DROP POLICY IF EXISTS "${POLICY_NAME}" ON "${table}"`)
      );

      // Create the org-isolation policy — FAIL-CLOSED (DEBT-010).
      //
      // Previous policy was fail-OPEN: an unset/empty `app.current_org_id` was
      // treated as "sysadmin bypass" and `organization_id IS NULL` rows were
      // always visible. Combined with a pooled connection that never received the
      // context, a query could see EVERY tenant's rows. The new policy denies by
      // default: a row is visible/writable ONLY when the request is an explicit
      // system_owner (server-set flag `app.is_system_owner`) OR the row's org
      // equals the request's org. Missing context ⇒ both operands are NULL ⇒
      // NULL (not true) ⇒ zero rows. `WITH CHECK` mirrors USING so INSERT/UPDATE
      // cannot move a row into another tenant.
      //
      // NOTE (prerequisite before enabling RLS enforcement in prod): tenant rows
      // must have a non-null organization_id (see DEBT-010 backfill) — this policy
      // intentionally does NOT grant blanket visibility to organization_id IS NULL.
      // Only `app.is_system_owner='true'` (never client-settable) is global.
      const predicate = `
        current_setting('app.is_system_owner', TRUE) = 'true'
        OR organization_id = NULLIF(current_setting('app.current_org_id', TRUE), '')::integer
      `;
      await db.execute(
        sql.raw(`
          CREATE POLICY "${POLICY_NAME}" ON "${table}"
          AS PERMISSIVE FOR ALL
          USING (${predicate})
          WITH CHECK (${predicate})
        `)
      );

      logger.debug({ table }, "RLS policy applied");
    } catch (err: any) {
      // Log and continue — some tables may not have organization_id; that's fine.
      logger.warn({ table, err: err.message }, "RLS init: skipped table (likely no organization_id column)");
    }
  }

  logger.info({ tables: RLS_TABLES }, "RLS policies initialised");
}
