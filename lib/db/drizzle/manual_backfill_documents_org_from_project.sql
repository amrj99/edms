-- =============================================================================
-- manual_backfill_documents_org_from_project.sql  (DATA-ONLY, MANUAL, journal-excluded)
-- =============================================================================
-- Backfills the legacy NULL organization_id on tenant document rows from the
-- SINGLE source of truth: projects.organization_id (the project owner). This is
-- the same value the document create path already writes
-- (artifacts/api-server/src/routes/documents.ts:440,451) and the same source
-- migration 0032 uses for files. It closes the broad legacy gap where documents
-- created before the create-path populated org were left NULL, which:
--   (a) disables RLS tenant isolation for those rows — rls-init.ts makes any
--       "organization_id IS NULL" row visible to every org (fail-OPEN); and
--   (b) makes orgScopedWhere-gated actions 404 for the rightful owner, because
--       orgScopedWhere uses eq(org, caller.org) with no NULL branch (fail-CLOSED).
--
-- SCOPE (tightly bounded; NEVER touches a non-NULL row):
--   * documents:          organization_id IS NULL AND project HAS an owner   -> project owner
--   * document_files:     organization_id IS NULL AND parent doc was a target -> project owner
--   * document_revisions: organization_id IS NULL AND parent doc was a target -> project owner
-- Files/revisions under already-owned documents are OUT OF SCOPE: files are
-- migration 0032's job; any NULL-org revision under an already-owned doc is
-- reported by the verification queries, not touched here.
--
-- SOURCE OF TRUTH: projects.organization_id ONLY. No inference from creator,
-- file, or any other field. A NULL-org document whose project has NO owner
-- ABORTs the whole transaction (no guessing).
--
-- NEVER run by the drizzle migrator (journal-excluded, manual_ prefix). Applied
-- by hand, once, under the operational gate — with the external pre-image
-- captured immediately before (see docs/operations/BACKFILL-DOCUMENTS-ORG.md).
--
-- Pre-image (capture BEFORE, external, bound to DB identity + capture time):
--   COPY (
--     SELECT 'doc' AS kind, d.id AS row_id, d.organization_id AS previous_org,
--            p.organization_id AS target_org, current_database() AS database_name,
--            (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier,
--            now()::text AS captured_at
--     FROM documents d JOIN projects p ON p.id=d.project_id
--     WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL
--     UNION ALL
--     SELECT 'file', df.id, df.organization_id, p.organization_id, current_database(),
--            (SELECT system_identifier FROM pg_control_system())::text, now()::text
--     FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id
--     WHERE df.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL
--     UNION ALL
--     SELECT 'rev', r.id, r.organization_id, p.organization_id, current_database(),
--            (SELECT system_identifier FROM pg_control_system())::text, now()::text
--     FROM document_revisions r JOIN documents d ON d.id=r.document_id JOIN projects p ON p.id=d.project_id
--     WHERE r.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL
--   ) TO STDOUT WITH CSV HEADER
-- =============================================================================
BEGIN;

-- Snapshot the exact target documents BEFORE mutating, so the file/revision
-- backfill is restricted to docs that were NULL-org — it can never contaminate an
-- already-owned document's files/revisions (those are out of scope).
CREATE TEMP TABLE _bf_targets ON COMMIT DROP AS
SELECT d.id AS doc_id, p.organization_id AS target_org
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL;

-- Fail-closed pre-check: refuse the whole run if any NULL-org document belongs to
-- a project with no owner org. We do not guess a value for it.
DO $$
DECLARE orphan int;
BEGIN
  SELECT count(*) INTO orphan
  FROM documents d JOIN projects p ON p.id = d.project_id
  WHERE d.organization_id IS NULL AND p.organization_id IS NULL;
  IF orphan > 0 THEN
    RAISE EXCEPTION 'backfill ABORT: % NULL-org document(s) belong to a project with no owner org — refusing to guess.', orphan;
  END IF;
END $$;

-- (1) documents  <- project owner
UPDATE documents d
SET organization_id = t.target_org
FROM _bf_targets t
WHERE d.id = t.doc_id
  AND d.organization_id IS NULL;

-- (2) files under target docs, still NULL  <- project owner
UPDATE document_files df
SET organization_id = t.target_org
FROM _bf_targets t
WHERE df.document_id = t.doc_id
  AND df.organization_id IS NULL;

-- (3) revisions under target docs, still NULL  <- project owner
UPDATE document_revisions r
SET organization_id = t.target_org
FROM _bf_targets t
WHERE r.document_id = t.doc_id
  AND r.organization_id IS NULL;

-- Post-check: no NULL-org tenant docs remain; no NULL-org file/revision remains
-- under a target doc. Any failure rolls the whole transaction back.
DO $$
DECLARE null_docs int; null_files int; null_revs int;
BEGIN
  SELECT count(*) INTO null_docs FROM documents d JOIN projects p ON p.id=d.project_id
    WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL;
  SELECT count(*) INTO null_files FROM document_files df JOIN _bf_targets t ON t.doc_id=df.document_id
    WHERE df.organization_id IS NULL;
  SELECT count(*) INTO null_revs FROM document_revisions r JOIN _bf_targets t ON t.doc_id=r.document_id
    WHERE r.organization_id IS NULL;
  IF null_docs <> 0 OR null_files <> 0 OR null_revs <> 0 THEN
    RAISE EXCEPTION 'backfill ABORT: post-check failed (docs=%, files=%, revs=%).', null_docs, null_files, null_revs;
  END IF;
END $$;

-- Inspect the row counts printed by the UPDATEs, then COMMIT.
COMMIT;
