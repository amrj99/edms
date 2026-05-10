/**
 * integrity-migrations.ts — H1 Production Database Integrity Fixes
 *
 * Applies the DB-level constraints that the Drizzle schema declares but that
 * were never enforced because this project has no migration runner (tables are
 * created via CREATE TABLE IF NOT EXISTS in seed-plans.ts).
 *
 * Every statement is IDEMPOTENT — safe to run on every startup:
 *   - FK constraints use a PL/pgSQL DO block that checks
 *     information_schema.table_constraints before applying.
 *   - Column additions use ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
 *
 * Startup order (see app.ts):
 *   seedPlans()            → ensures tables exist
 *   runIntegrityMigrations() → applies constraints + column + orphan check
 *
 * Rollback (if needed on VPS):
 *   ALTER TABLE users    DROP CONSTRAINT IF EXISTS users_organization_id_fkey;
 *   ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_organization_id_fkey;
 *   ALTER TABLE users    DROP COLUMN IF EXISTS email_verification_token_expires_at;
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runIntegrityMigrations(): Promise<void> {
  try {
    // ── H1.3: email_verification_token_expires_at column ──────────────────────
    // Tokens generated before this column existed will have NULL here, which the
    // verify-email handler treats as "no expiry set" (backward-compatible).
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verification_token_expires_at TIMESTAMP
    `);
    logger.info("[integrity] email_verification_token_expires_at column ensured");

    // ── H1.1: users.organization_id FK — ON DELETE SET NULL ──────────────────
    // Drizzle schema: organizationId integer("organization_id").references(() => organizationsTable.id)
    // The Drizzle-declared reference was never applied to the live DB.
    // ON DELETE SET NULL: when an org is deleted, users are preserved with
    // organization_id set to NULL rather than deleted or left with a dangling int.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'users_organization_id_fkey'
            AND table_name      = 'users'
            AND constraint_type = 'FOREIGN KEY'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_organization_id_fkey
            FOREIGN KEY (organization_id)
            REFERENCES organizations(id)
            ON DELETE SET NULL;
          RAISE NOTICE '[integrity] users_organization_id_fkey created';
        END IF;
      END $$
    `);
    logger.info("[integrity] users.organization_id FK ensured (ON DELETE SET NULL)");

    // ── H1.2: projects.organization_id FK — ON DELETE RESTRICT ───────────────
    // Drizzle schema: organizationId integer("organization_id").references(() => organizationsTable.id).notNull()
    // ON DELETE RESTRICT: attempting to delete an org that still owns projects
    // raises a FK violation — the admin must archive/delete projects first.
    // This prevents silent data loss of entire project hierarchies.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'projects_organization_id_fkey'
            AND table_name      = 'projects'
            AND constraint_type = 'FOREIGN KEY'
        ) THEN
          ALTER TABLE projects
            ADD CONSTRAINT projects_organization_id_fkey
            FOREIGN KEY (organization_id)
            REFERENCES organizations(id)
            ON DELETE RESTRICT;
          RAISE NOTICE '[integrity] projects_organization_id_fkey created';
        END IF;
      END $$
    `);
    logger.info("[integrity] projects.organization_id FK ensured (ON DELETE RESTRICT)");

    // ── H1.4: Startup orphan detection ───────────────────────────────────────
    // After H1.1 is applied the FK prevents new orphans, but existing data may
    // have been corrected or may still have issues. This check runs every startup
    // and surfaces any remaining orphaned users in the docker logs immediately.
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS orphaned
      FROM users u
      WHERE u.organization_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM organizations o WHERE o.id = u.organization_id
        )
    `);
    const orphaned = Number((result.rows?.[0] as any)?.orphaned ?? 0);

    if (orphaned > 0) {
      logger.warn(
        { orphaned },
        "[integrity] ORPHANED USERS DETECTED — organization_id references non-existent orgs. " +
        "Diagnose: SELECT id, email, organization_id FROM users WHERE organization_id IS NOT NULL " +
        "AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = users.organization_id);"
      );
    } else {
      logger.info("[integrity] orphan check passed — 0 users with dangling organization_id");
    }

  } catch (err) {
    // Never crash startup — log and continue. Missing constraints are a risk
    // but the application can still operate; this will be visible in docker logs.
    logger.error(
      { err },
      "[integrity] H1 integrity migrations failed — startup continues but DB constraints may be missing. Check logs and re-deploy."
    );
  }
}
