-- ════════════════════════════════════════════════════════════════════════════
-- 0010_audit_schema.sql
-- Add structured before/after state columns and supporting indexes to
-- audit_logs.
--
-- What this does:
--   - Adds 4 NULLABLE columns (zero impact on existing rows)
--   - Adds 2 indexes to support forensic queries by entity and by user
--
-- What this does NOT do:
--   - Alter any existing data
--   - Remove any column
--   - Break any existing query or application path
--
-- All new columns are optional — the application writes them only on new
-- events that carry structured state.  All existing call sites continue to
-- work without modification.
--
-- Rollback (run manually on VPS if needed):
--   DROP INDEX CONCURRENTLY IF EXISTS idx_audit_logs_entity;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_audit_logs_user_created;
--   ALTER TABLE audit_logs
--     DROP COLUMN IF EXISTS before_state,
--     DROP COLUMN IF EXISTS after_state,
--     DROP COLUMN IF EXISTS actor_role,
--     DROP COLUMN IF EXISTS user_agent;
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columns ──────────────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS with a nullable type takes a metadata-only lock in
-- Postgres 11+ — no table rewrite, no downtime.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS before_state  JSONB,
  ADD COLUMN IF NOT EXISTS after_state   JSONB,
  ADD COLUMN IF NOT EXISTS actor_role    TEXT,
  ADD COLUMN IF NOT EXISTS user_agent    TEXT;

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Both use IF NOT EXISTS so this migration is safe to re-run.
-- On a live production system, prefer CREATE INDEX CONCURRENTLY (no lock).

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── Verification query ────────────────────────────────────────────────────────
-- \d audit_logs
-- Expected: before_state, after_state, actor_role, user_agent columns visible
-- SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';
-- Expected: idx_audit_logs_entity and idx_audit_logs_user_created present
