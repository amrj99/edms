-- =============================================================================
-- rollback_b2fix_docs_55_56_57.sql   (MANUAL, journal-excluded, fail-closed)
-- =============================================================================
-- Reverts manual_b2fix_docs_55_56_57_org_from_project.sql using the pre-image artifact
-- captured immediately before it. Reverts a row (doc or file) to its NULL org
-- ONLY IF it still holds the exact value the fix set (current == target). Any row
-- changed after the fix is REPORTED and left untouched. Loads the artifact from a
-- FIXED in-container path (staged by the operator via docker cp), so no manual
-- \copy edit. NEVER run by the migrator.
-- =============================================================================
BEGIN;

CREATE TEMP TABLE _rb_b2_artifact (
  kind                 text,      -- 'doc' | 'file'
  row_id               integer,
  previous_org         integer,   -- NULL for every B2 row
  target_org           integer,   -- what the fix set (project owner)
  database_name        text,
  db_system_identifier text
) ON COMMIT DROP;

\copy _rb_b2_artifact FROM '/tmp/_rb_b2_artifact.csv' CSV HEADER

-- ── Fail-closed guards ──────────────────────────────────────────────────────
DO $$
DECLARE n int; bad int;
  live_sid text := (SELECT system_identifier::text FROM pg_control_system());
  live_db  text := current_database();
BEGIN
  SELECT count(*) INTO n FROM _rb_b2_artifact;
  IF n = 0 THEN RAISE EXCEPTION 'rollback_b2fix ABORT: pre-image artifact empty or not loaded.'; END IF;
  SELECT count(*) INTO bad FROM _rb_b2_artifact
   WHERE db_system_identifier IS DISTINCT FROM live_sid OR database_name IS DISTINCT FROM live_db;
  IF bad > 0 THEN
    RAISE EXCEPTION 'rollback_b2fix ABORT: artifact DB identity does not match this database (% / %).', live_db, live_sid;
  END IF;
END $$;

-- ── Report diverged rows (changed since the fix) — SKIPPED, never overwritten ─
CREATE TEMP TABLE _rb_b2_diverged ON COMMIT DROP AS
SELECT a.kind, a.row_id, a.target_org AS expected_from_fix,
       CASE a.kind WHEN 'doc'  THEN (SELECT organization_id FROM documents      WHERE id = a.row_id)
                   WHEN 'file' THEN (SELECT organization_id FROM document_files WHERE id = a.row_id) END AS current_org
FROM _rb_b2_artifact a
WHERE CASE a.kind WHEN 'doc'  THEN (SELECT organization_id FROM documents      WHERE id = a.row_id)
                  WHEN 'file' THEN (SELECT organization_id FROM document_files WHERE id = a.row_id) END
      IS DISTINCT FROM a.target_org;

-- ── Fail-closed revert: ONLY rows still equal to what the fix set ────────────
UPDATE documents d SET organization_id = a.previous_org           -- NULL
FROM _rb_b2_artifact a
WHERE a.kind = 'doc' AND d.id = a.row_id AND d.organization_id = a.target_org;

UPDATE document_files df SET organization_id = a.previous_org      -- NULL
FROM _rb_b2_artifact a
WHERE a.kind = 'file' AND df.id = a.row_id AND df.organization_id = a.target_org;

-- Inspect _rb_b2_diverged before COMMIT; ROLLBACK if unexpected.
COMMIT;
