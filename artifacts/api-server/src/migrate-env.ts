/**
 * migrate-env.ts — DEBT-010: bind the migrator process to the privileged migrator/owner role.
 *
 * This module MUST be imported by migrate.ts BEFORE @workspace/db, because @workspace/db
 * creates its pool from process.env.DATABASE_URL at import time. By overriding DATABASE_URL
 * with MIGRATION_DATABASE_URL here first, the shared pool/db — and every install step that
 * uses it (drizzle migrate, seedPlans, runIntegrityMigrations, applyMembershipRls) — connects
 * as the migrator/owner role.
 *
 * The runtime app (index.ts) does NOT import this module, so it keeps using DATABASE_URL —
 * the least-privilege `edms_app` role. This is what lets the SAME container run:
 *   • migrate.mjs  → owner/migrator (DDL: schema, constraints, RLS install)
 *   • index.mjs    → edms_app (DML only, RLS enforced)
 *
 * Fallback: if MIGRATION_DATABASE_URL is unset/blank, DATABASE_URL is left untouched, so
 * single-role deployments (and every existing environment) keep working exactly as before.
 */
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (typeof migrationUrl === "string" && migrationUrl.trim() !== "") {
  process.env.DATABASE_URL = migrationUrl;
}
