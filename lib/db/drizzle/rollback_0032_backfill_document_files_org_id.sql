-- =============================================================================
-- rollback_0032_backfill_document_files_org_id.sql
-- =============================================================================
-- MANUAL RECOVERY ONLY. This file is intentionally EXCLUDED from the journal
-- (rollback_*.sql) and is NEVER run by the migrator — see
-- scripts/check-migration-journal.sh.
--
-- Reverts the class-B1 backfill applied by 0032. It restores organization_id to
-- NULL for EXACTLY the rows that 0032 changed.
--
-- WHY A PRE-IMAGE IS REQUIRED (not re-derivable post-hoc):
--   After 0032 runs, a backfilled B1 row (file_org now = owner) is textually
--   indistinguishable from an always-correct C row (file_org was already = owner).
--   A blind `SET organization_id = NULL WHERE organization_id = owner` would also
--   NULL the legitimate C rows. So the exact id set must be captured BEFORE apply.
--
-- PRE-IMAGE CAPTURE (run immediately BEFORE applying 0032; save output OUTSIDE
-- production — this list is identical to the set 0032 will change):
--     SELECT df.id
--     FROM document_files df
--     JOIN documents d ON d.id = df.document_id
--     JOIN projects  p ON p.id = d.project_id
--     WHERE df.organization_id IS NULL
--       AND d.organization_id = p.organization_id;
--   → saved as 0032_preimage_<utc-timestamp>.csv (deploy artifact).
--   Backstop: the standard pre-deploy pg_dump already contains the full
--   pre-backfill state of document_files.
--
-- TO ROLL BACK: load the captured ids into the temp table below (\copy or
-- explicit INSERTs), then run this script in one session.
-- =============================================================================

BEGIN;

-- Session-scoped staging for the captured pre-image ids (auto-dropped on COMMIT;
-- leaves NO permanent object in the production schema).
CREATE TEMP TABLE _rb0032_preimage (id integer PRIMARY KEY) ON COMMIT DROP;

-- Load the captured pre-image here, e.g.:
--   \copy _rb0032_preimage(id) FROM '0032_preimage_<utc-timestamp>.csv' CSV
--   -- or --
--   INSERT INTO _rb0032_preimage(id) VALUES (123), (456), ... ;

UPDATE document_files
SET organization_id = NULL
WHERE id IN (SELECT id FROM _rb0032_preimage)
  AND organization_id IS NOT NULL;

-- Verify BEFORE committing: this must equal the number of ids you loaded.
--   SELECT count(*) FROM document_files
--   WHERE id IN (SELECT id FROM _rb0032_preimage) AND organization_id IS NULL;

COMMIT;
