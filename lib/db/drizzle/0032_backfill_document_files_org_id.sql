-- =============================================================================
-- 0032_backfill_document_files_org_id.sql   (DATA-ONLY migration)
-- =============================================================================
-- Phase 2 follow-up — Backfill document_files.organization_id, class B1 ONLY.
--
-- WHY:
--   Legacy (pre-B2.3a) document_files rows carry organization_id = NULL. Because
--   of that, the soft-delete predicate (B2.3b-1) omits file.organization_id (the
--   documented "Legacy Exception"), and those NULL rows also slip through the
--   org-isolation RLS policy (its `organization_id IS NULL` branch). Attributing
--   each SAFELY-resolvable file to its owner org lets the exception be lifted and
--   RLS fully apply — without changing any behaviour that depends on a real org.
--
-- SOURCE OF TRUTH (decided):
--   projects.organization_id — the project owner org (NOT NULL) — is the final
--   authority for document + file ownership. documents.organization_id is a
--   corroborating layer only; it NEVER overrides the project owner. Where the two
--   disagree it is a Data Integrity Incident, reported and decided separately —
--   NEVER auto-repaired here.
--
-- SCOPE — class B1 ONLY (safe + unambiguous):
--     file_org IS NULL  AND  doc_org = project_owner_org
--   → set organization_id = project_owner_org.
--
-- DELIBERATELY UNTOUCHED (reported for a separate, later decision/batch):
--   B2  file_org IS NULL     AND doc_org IS NULL                 (parent doc itself lacks org)
--   B3  file_org IS NULL     AND doc_org IS NOT NULL AND doc_org <> owner  (doc/project disagree)
--   D   file_org IS NOT NULL AND file_org <> owner               (file mismatch — repair later)
--   E   doc_org  IS NOT NULL AND doc_org  <> owner               (doc-level drift — incident)
--
-- PROPERTIES:
--   • data-only — NO schema change, NO column set to NOT NULL (hence no snapshot).
--   • idempotent — the `organization_id IS NULL` guard makes a re-run touch 0 rows.
--   • the `d.organization_id = p.organization_id` guard sets B1 apart from B2/B3/E.
--   • NO storage / file_url / storage-object / quota / audit side effects.
--   • the runtime migrator wraps this file in its outer BEGIN/COMMIT.
--
-- ROLLBACK:
--   rollback_0032_backfill_document_files_org_id.sql (journal-excluded, manual)
--   driven by the pre-image id list captured immediately before apply, plus the
--   standard pre-deploy pg_dump backstop. See docs/migrations/0032-backfill-document-files-org.md.
-- =============================================================================

UPDATE document_files df
SET organization_id = p.organization_id
FROM documents d
JOIN projects  p ON p.id = d.project_id
WHERE df.document_id = d.id
  AND df.organization_id IS NULL
  AND d.organization_id = p.organization_id;
