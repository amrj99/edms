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

      // Create the org-isolation policy (permissive = OR semantics)
      await db.execute(
        sql.raw(`
          CREATE POLICY "${POLICY_NAME}" ON "${table}"
          AS PERMISSIVE FOR ALL
          USING (
            -- 1. Rows with no org assignment are always visible (system-wide data)
            organization_id IS NULL
            OR
            -- 2. Empty session variable = sysadmin bypass (sees all rows)
            COALESCE(NULLIF(current_setting('app.current_org_id', TRUE), ''), NULL) IS NULL
            OR
            -- 3. Row belongs to the requesting org
            organization_id = NULLIF(current_setting('app.current_org_id', TRUE), '')::integer
          )
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
