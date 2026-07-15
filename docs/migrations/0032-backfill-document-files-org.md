# Migration 0032 — Backfill `document_files.organization_id` (B1 only)

**Type:** data-only · **Batch:** Phase 2 follow-up (Legacy-Exception prerequisite) · **Deploy:** gated, `[skip deploy]`, NOT applied to production by this PR.

## Purpose
Legacy (pre-B2.3a) `document_files` rows carry `organization_id = NULL`. That NULL:
- forces the B2.3b-1 soft-delete predicate to omit `file.organization_id` (the documented **Legacy Exception**), and
- lets those rows bypass the org-isolation RLS policy (its `organization_id IS NULL` branch).

This migration attributes each **safely-resolvable** file to its owner org so the exception can later be lifted and RLS fully applies.

## Source of truth (decided)
`projects.organization_id` — the **project owner org** (NOT NULL) — is the final authority for document + file ownership. `documents.organization_id` is a corroborating layer only; it **never** overrides the project owner. Where they disagree it is a **Data Integrity Incident**, reported — never auto-repaired here.

## Classification
Resolved per file via `document_files.document_id → documents → projects`:

| Class | Predicate | Action in 0032 |
|---|---|---|
| **B1** | `file_org IS NULL AND doc_org = project_owner` | ✅ **set `organization_id = project_owner`** |
| B2 | `file_org IS NULL AND doc_org IS NULL` | ⏸ leave — parent doc itself lacks org (later batch) |
| B3 | `file_org IS NULL AND doc_org IS NOT NULL AND doc_org <> owner` | ⏸ leave — doc/project disagree |
| C | `file_org = project_owner` | leave — already correct |
| D | `file_org IS NOT NULL AND file_org <> owner` | 🚩 leave — mismatch repair (separate decision) |
| E | `doc_org IS NOT NULL AND doc_org <> owner` | 🚩 leave — doc-level drift (incident) |

Structural guarantees (verified against schema): `document_id` is NOT NULL + FK and `projects.organization_id` is NOT NULL ⇒ **no orphan / missing-document rows are possible**, and a project-owner org is always derivable.

## Forward SQL (`0032_backfill_document_files_org_id.sql`)
```sql
UPDATE document_files df
SET organization_id = p.organization_id
FROM documents d
JOIN projects  p ON p.id = d.project_id
WHERE df.document_id = d.id
  AND df.organization_id IS NULL
  AND d.organization_id = p.organization_id;   -- B1 fence: excludes B2/B3/D/E
```
Idempotent (`IS NULL` guard → re-run touches 0 rows). No schema change, no `NOT NULL`, no storage/URL/quota/audit side effects.

## Before / classification report (run on a production snapshot)
```sql
WITH f AS (
  SELECT df.id file_id, df.organization_id file_org,
         d.organization_id doc_org, p.organization_id proj_owner
  FROM document_files df
  JOIN documents d ON d.id = df.document_id
  JOIN projects  p ON p.id = d.project_id)
SELECT
  count(*) total,
  count(*) FILTER (WHERE file_org IS NULL AND doc_org = proj_owner)                                   b1,
  count(*) FILTER (WHERE file_org IS NULL AND doc_org IS NULL)                                        b2,
  count(*) FILTER (WHERE file_org IS NULL AND doc_org IS NOT NULL AND doc_org <> proj_owner)          b3,
  count(*) FILTER (WHERE file_org = proj_owner)                                                       c_ok,
  count(*) FILTER (WHERE file_org IS NOT NULL AND file_org <> proj_owner)                             d_mismatch,
  count(*) FILTER (WHERE doc_org IS NOT NULL AND doc_org <> proj_owner)                               e_docdrift
FROM f;
```

## Unresolved detail report (B2 / B3 / D / E — for the separate decision)
Emits `file_id, document_id, project_id, file_org, doc_org, project_owner_org, uploader, storage_mode, klass` (no secrets — `storage_mode` is derived from the URL prefix only). The exact query is asserted in `artifacts/api-server/src/test/backfill-document-files-org.test.ts` (`unresolved-report` case).

## Pre-image & Rollback — alternatives and choice
Requirement: exact reversibility with **no permanent, undocumented backup table** in the production schema.

| Option | Prod-schema footprint | Robustness | Verdict |
|---|---|---|---|
| **A. Pre-image id-list (chosen)** | none | high | Capture the B1 id set immediately *before* apply → external artifact `0032_preimage_<utc>.csv`; roll back via `rollback_0032_*.sql` (journal-excluded) using a session `TEMP TABLE ... ON COMMIT DROP`. Matches the project's sanctioned `rollback_*.sql` convention. |
| B. Self-contained pre-image table | adds a table | high | Rejected: leaves a table in prod between deploy and rollback; lifecycle/drop ownership becomes an open question. |
| C. Re-derive post-hoc | none | **unsafe** | Rejected: a backfilled B1 row is indistinguishable from an always-correct C row after apply → would NULL C rows too. |

**Chosen = A**, with the standard **pre-deploy `pg_dump`** (already in the deploy pipeline; see `docs/operations/BACKUP-AND-RECOVERY.md`) as the full backstop.

Pre-image capture (run immediately before apply, save output outside prod — identical to the set 0032 changes):
```sql
SELECT df.id FROM document_files df
JOIN documents d ON d.id = df.document_id
JOIN projects  p ON p.id = d.project_id
WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id;
```
Rollback: load those ids into `_rb0032_preimage` and run `rollback_0032_backfill_document_files_org_id.sql`.

## Acceptance criteria (all asserted in the migration test)
- **AC1** B1 rows → `organization_id = project owner`.
- **AC2** exactly the B1 count changed (rowCount == |B1|); pre-image capture == B1 set.
- **AC3** B2 / B3 / C / D / E unchanged.
- **AC4** idempotent — second apply changes 0 rows.
- **AC5** no other column changed (`file_url`/`file_name`/`file_size`/`sha256`/`deleted_at`).
- **AC6** unresolved report classifies B2/B3/D/E with the required columns.

## Out of scope (deferred, per decision)
B2 repair (fix parent `documents.organization_id` from project owner first, then its files), and D/E incident resolution — each a separate batch after review. Not started here.
