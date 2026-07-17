-- =============================================================================
-- manual_b2fix_docs_55_56_57_org_from_project.sql   (DATA-ONLY, MANUAL, journal-excluded)
-- =============================================================================
-- Closes the limited "B2" set found by the 0032 read-only gate on production:
-- documents 55/56/57 (project 1) whose organization_id IS NULL AND whose parent
-- document also lacks an org, so 0032's B1 fence correctly skips their files.
--
-- Source of truth (same as 0032): projects.organization_id — the PROJECT OWNER.
-- It sets the parent document org from the project owner, then the document's
-- files. Scoped to id IN (55,56,57) AND organization_id IS NULL only. No other
-- record is touched. NEVER run by the migrator — owner-run, once, under the gate.
--
-- Pre-image (capture BEFORE, external, like 0032):
--   COPY ( SELECT 'doc' AS kind, d.id AS row_id, d.organization_id AS previous_org,
--                 p.organization_id AS target_org, current_database() AS database_name,
--                 (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier
--          FROM documents d JOIN projects p ON p.id=d.project_id
--          WHERE d.id IN (55,56,57) AND d.organization_id IS NULL
--          UNION ALL
--          SELECT 'file', df.id, df.organization_id, p.organization_id, current_database(),
--                 (SELECT system_identifier FROM pg_control_system())::text
--          FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id
--          WHERE d.id IN (55,56,57) AND df.organization_id IS NULL
--        ) TO STDOUT WITH CSV HEADER
-- =============================================================================
BEGIN;

-- ── Fail-closed pre-check: refuse if any target doc is no longer NULL-org ─────
DO $$
DECLARE changed int;
BEGIN
  SELECT count(*) INTO changed FROM documents
   WHERE id IN (55,56,57) AND organization_id IS NOT NULL;
  IF changed > 0 THEN
    RAISE EXCEPTION 'b2fix ABORT: % of docs {55,56,57} already have a non-NULL org — state changed, refusing.', changed;
  END IF;
END $$;

-- ── (1) Parent documents ← project owner (source of truth) ───────────────────
UPDATE documents d
SET organization_id = p.organization_id
FROM projects p
WHERE p.id = d.project_id
  AND d.id IN (55,56,57)
  AND d.organization_id IS NULL;

-- ── (2) Their files ← project owner (only files still NULL under these docs) ──
UPDATE document_files df
SET organization_id = p.organization_id
FROM documents d
JOIN projects p ON p.id = d.project_id
WHERE df.document_id = d.id
  AND d.id IN (55,56,57)
  AND df.organization_id IS NULL;

-- ── Post-check: the 3 docs now non-NULL; no NULL-org file remains under them ──
DO $$
DECLARE null_docs int; null_files int;
BEGIN
  SELECT count(*) INTO null_docs  FROM documents WHERE id IN (55,56,57) AND organization_id IS NULL;
  SELECT count(*) INTO null_files FROM document_files WHERE document_id IN (55,56,57) AND organization_id IS NULL;
  IF null_docs <> 0 OR null_files <> 0 THEN
    RAISE EXCEPTION 'b2fix ABORT: post-check failed (null docs=%, null files=%).', null_docs, null_files;
  END IF;
END $$;

-- Inspect the counts, then COMMIT.
COMMIT;
