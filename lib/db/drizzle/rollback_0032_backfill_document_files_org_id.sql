-- =============================================================================
-- rollback_0032_backfill_document_files_org_id.sql
-- =============================================================================
-- MANUAL RECOVERY ONLY. Intentionally EXCLUDED from the journal (rollback_*.sql)
-- and NEVER run by the migrator — see scripts/check-migration-journal.sh.
--
-- Reverts the class-B1 backfill applied by 0032, FAIL-CLOSED and AUDITABLE.
--
-- It NEVER blindly NULLs by id. It is driven by the PRE-IMAGE ARTIFACT captured
-- immediately BEFORE 0032 was applied, and it reverts a row ONLY IF that row is
-- still in the exact state 0032 produced (current org == captured target). Any
-- row that changed after the migration (a legitimate later edit) is REPORTED and
-- left untouched — a rollback must never clobber a newer, valid value.
--
-- ── PRE-IMAGE ARTIFACT (auditable) ──────────────────────────────────────────
-- Captured BEFORE apply with this exact query (rows == the set 0032 will change):
--
--   SELECT df.id                                          AS file_id,
--          df.organization_id                             AS previous_organization_id, -- NULL for B1
--          p.organization_id                              AS target_organization_id,
--          d.id                                           AS document_id,
--          d.project_id                                   AS project_id,
--          now()                                          AS captured_at,
--          current_database()                             AS database_name,
--          (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier
--   FROM document_files df
--   JOIN documents d ON d.id = df.document_id
--   JOIN projects  p ON p.id = d.project_id
--   WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id;
--
-- Saved OUTSIDE production as: 0032_preimage_<database>_<system_id>_<utc>.csv
-- Owner: deploy/platform operator. Retained per docs/operations/BACKUP-AND-RECOVERY.md.
-- Backstop: the standard pre-deploy pg_dump holds the full pre-backfill state.
-- =============================================================================

BEGIN;

-- Session-scoped staging (auto-dropped on COMMIT; no permanent prod object).
CREATE TEMP TABLE _rb0032_artifact (
  file_id                  integer PRIMARY KEY,
  previous_organization_id integer,           -- NULL for every B1 row
  target_organization_id   integer NOT NULL,  -- what 0032 set (project owner org)
  document_id              integer,
  project_id               integer,
  captured_at              timestamptz,
  database_name            text,
  db_system_identifier     text
) ON COMMIT DROP;

-- Load the captured artifact (headers must match the columns above):
--   \copy _rb0032_artifact FROM '0032_preimage_<database>_<system_id>_<utc>.csv' CSV HEADER

-- ── Fail-closed guards ──────────────────────────────────────────────────────
DO $$
DECLARE
  n_rows    int;
  bad_ident int;
  live_sid  text := (SELECT system_identifier::text FROM pg_control_system());
  live_db   text := current_database();
BEGIN
  -- (1) Refuse on an empty / missing artifact.
  SELECT count(*) INTO n_rows FROM _rb0032_artifact;
  IF n_rows = 0 THEN
    RAISE EXCEPTION 'rollback_0032 ABORT: pre-image artifact is empty or not loaded — refusing to run.';
  END IF;

  -- (2) Refuse if the artifact was not captured on THIS database cluster.
  SELECT count(*) INTO bad_ident FROM _rb0032_artifact
   WHERE db_system_identifier IS DISTINCT FROM live_sid
      OR database_name        IS DISTINCT FROM live_db;
  IF bad_ident > 0 THEN
    RAISE EXCEPTION 'rollback_0032 ABORT: artifact DB identity (%/%) does not match this database (%/%).',
      (SELECT database_name FROM _rb0032_artifact LIMIT 1),
      (SELECT db_system_identifier FROM _rb0032_artifact LIMIT 1), live_db, live_sid;
  END IF;
END $$;

-- ── (3) Report rows that DIVERGED after the migration — these are SKIPPED ────
-- current org differs from what 0032 set → a legitimate later change; never
-- overwritten. Inspect this table before COMMIT.
CREATE TEMP TABLE _rb0032_diverged ON COMMIT DROP AS
SELECT a.file_id,
       a.target_organization_id AS expected_org_from_0032,
       df.organization_id       AS current_org
FROM _rb0032_artifact a
JOIN document_files df ON df.id = a.file_id
WHERE df.organization_id IS DISTINCT FROM a.target_organization_id;

-- ── (4) Fail-closed revert: ONLY rows still equal to what 0032 set ──────────
UPDATE document_files df
SET organization_id = a.previous_organization_id            -- NULL for B1
FROM _rb0032_artifact a
WHERE df.id = a.file_id
  AND df.organization_id = a.target_organization_id;        -- guard: unchanged since 0032

-- ── Verify BEFORE COMMIT (manual) ───────────────────────────────────────────
--   SELECT * FROM _rb0032_diverged;   -- rows intentionally skipped (must be reviewed)
--   -- reverted rows now hold previous_organization_id; skipped rows are untouched.
-- If _rb0032_diverged is non-empty and unexpected, ROLLBACK and investigate.

COMMIT;
