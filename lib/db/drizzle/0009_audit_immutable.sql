-- ════════════════════════════════════════════════════════════════════════════
-- 0009_audit_immutable.sql
-- Make audit_logs append-only at the database level.
--
-- What this does:
--   Creates a trigger function that raises an exception on any attempt to
--   UPDATE or DELETE a row in audit_logs.  INSERTs are completely unaffected.
--
-- What this does NOT do:
--   - Alter any data
--   - Add or remove any columns
--   - Touch any index
--   - Change application behaviour in any way
--
-- Rollback (run manually on VPS if needed):
--   DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
--   DROP FUNCTION IF EXISTS fn_audit_logs_immutable();
-- ════════════════════════════════════════════════════════════════════════════

DO $outer$ BEGIN

  -- 1. Trigger function — raises on UPDATE or DELETE ─────────────────────────
  CREATE OR REPLACE FUNCTION fn_audit_logs_immutable()
  RETURNS trigger LANGUAGE plpgsql AS
  $fn$
  BEGIN
    RAISE EXCEPTION
      'audit_logs is append-only. UPDATE and DELETE are not permitted. '
      'If a correction is required, contact the database administrator.';
    RETURN NULL;
  END;
  $fn$;

  -- 2. Trigger — fires BEFORE UPDATE or DELETE, per row ─────────────────────
  --    Guarded with an existence check so the migration is safe to re-run.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_logs_immutable'
      AND tgrelid = 'audit_logs'::regclass
  ) THEN
    CREATE TRIGGER trg_audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_immutable();
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END $outer$;

-- ── Verification query (run after applying to confirm) ────────────────────────
-- SELECT tgname, tgenabled
--   FROM pg_trigger
--  WHERE tgname = 'trg_audit_logs_immutable';
-- Expected: one row, tgenabled = 'O' (origin)
--
-- Smoke test:
-- DELETE FROM audit_logs WHERE id = -999;
-- Expected: ERROR: audit_logs is append-only...
