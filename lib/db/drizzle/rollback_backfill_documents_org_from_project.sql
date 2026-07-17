-- =============================================================================
-- rollback_backfill_documents_org_from_project.sql  (MANUAL, journal-excluded, fail-closed)
-- =============================================================================
-- Reverts manual_backfill_documents_org_from_project.sql using the pre-image
-- artifact captured immediately before it. A row (doc/file/rev) is reverted to
-- its previous org (NULL) ONLY IF it still holds the exact value the backfill set
-- (current == target_org). Any row changed after the backfill is REPORTED
-- (_rb_bf_diverged) and left untouched. Loads the artifact from a FIXED
-- in-container path staged by the operator via docker cp. NEVER run by the migrator.
-- =============================================================================
BEGIN;

CREATE TEMP TABLE _rb_bf_artifact (
  kind                 text,      -- 'doc' | 'file' | 'rev'
  row_id               integer,
  previous_org         integer,   -- NULL for every backfilled row
  target_org           integer,   -- what the backfill set (project owner)
  database_name        text,
  db_system_identifier text,
  captured_at          text
) ON COMMIT DROP;

\copy _rb_bf_artifact FROM '/tmp/_rb_backfill_docs_org.csv' CSV HEADER

-- ── Fail-closed guards ──────────────────────────────────────────────────────
DO $$
DECLARE n int; bad int;
  live_sid text := (SELECT system_identifier::text FROM pg_control_system());
  live_db  text := current_database();
BEGIN
  SELECT count(*) INTO n FROM _rb_bf_artifact;
  IF n = 0 THEN RAISE EXCEPTION 'rollback_backfill ABORT: pre-image artifact empty or not loaded.'; END IF;
  SELECT count(*) INTO bad FROM _rb_bf_artifact
   WHERE db_system_identifier IS DISTINCT FROM live_sid OR database_name IS DISTINCT FROM live_db;
  IF bad > 0 THEN
    RAISE EXCEPTION 'rollback_backfill ABORT: artifact DB identity does not match this database (% / %).', live_db, live_sid;
  END IF;
END $$;

-- ── Report diverged rows (changed since the backfill) — SKIPPED, never overwritten
CREATE TEMP TABLE _rb_bf_diverged ON COMMIT DROP AS
SELECT a.kind, a.row_id, a.target_org AS expected_from_backfill,
       CASE a.kind WHEN 'doc'  THEN (SELECT organization_id FROM documents         WHERE id = a.row_id)
                   WHEN 'file' THEN (SELECT organization_id FROM document_files     WHERE id = a.row_id)
                   WHEN 'rev'  THEN (SELECT organization_id FROM document_revisions WHERE id = a.row_id) END AS current_org
FROM _rb_bf_artifact a
WHERE CASE a.kind WHEN 'doc'  THEN (SELECT organization_id FROM documents         WHERE id = a.row_id)
                  WHEN 'file' THEN (SELECT organization_id FROM document_files     WHERE id = a.row_id)
                  WHEN 'rev'  THEN (SELECT organization_id FROM document_revisions WHERE id = a.row_id) END
      IS DISTINCT FROM a.target_org;

-- ── Fail-closed revert: ONLY rows still equal to what the backfill set ───────
UPDATE documents d SET organization_id = a.previous_org           -- NULL
FROM _rb_bf_artifact a
WHERE a.kind = 'doc' AND d.id = a.row_id AND d.organization_id = a.target_org;

UPDATE document_files df SET organization_id = a.previous_org      -- NULL
FROM _rb_bf_artifact a
WHERE a.kind = 'file' AND df.id = a.row_id AND df.organization_id = a.target_org;

UPDATE document_revisions r SET organization_id = a.previous_org  -- NULL
FROM _rb_bf_artifact a
WHERE a.kind = 'rev' AND r.id = a.row_id AND r.organization_id = a.target_org;

-- Inspect _rb_bf_diverged before COMMIT; ROLLBACK if anything unexpected.
COMMIT;
