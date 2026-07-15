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

## Pre-image artifact (auditable)
Requirement: exact reversibility with **no permanent, undocumented backup table** in the production schema, and an artifact that is **auditable** (not an anonymous id list) and **bound to the exact database**.

**Format** — one CSV row per targeted B1 file, columns:

| column | meaning |
|---|---|
| `file_id` | the `document_files.id` being changed |
| `previous_organization_id` | value before 0032 (**NULL** for every B1 row) |
| `target_organization_id` | value 0032 sets = **project owner org** |
| `document_id`, `project_id` | ownership lineage (audit) |
| `captured_at` | capture timestamp |
| `database_name` | `current_database()` |
| `db_system_identifier` | `pg_control_system().system_identifier` — uniquely identifies the DB **cluster** |

**Generation** — run immediately *before* applying 0032 (rows == the exact set 0032 will change):
```sql
SELECT df.id                                          AS file_id,
       df.organization_id                             AS previous_organization_id,
       p.organization_id                              AS target_organization_id,
       d.id                                           AS document_id,
       d.project_id                                   AS project_id,
       now()                                          AS captured_at,
       current_database()                             AS database_name,
       (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier
FROM document_files df
JOIN documents d ON d.id = df.document_id
JOIN projects  p ON p.id = d.project_id
WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id;
```
**Storage & ownership** — saved OUTSIDE production as `0032_preimage_<database>_<system_id>_<utc>.csv`, alongside the pre-deploy `pg_dump`, owned by the deploy/platform operator, retained per `docs/operations/BACKUP-AND-RECOVERY.md`. The `<database>_<system_id>` in the filename + the per-row identity columns make it **self-identifying** to one cluster/run. Backstop = the pre-deploy `pg_dump` (full pre-backfill state).

## Rollback — fail-closed contract (`rollback_0032_*.sql`)
Journal-excluded, manual, never run by the migrator. It loads the artifact into a session `TEMP TABLE ... ON COMMIT DROP` (no permanent prod object) and **refuses to run** unless it is safe:

1. **Empty/missing artifact** → `RAISE EXCEPTION` (abort).
2. **DB identity mismatch** — any row whose `db_system_identifier`/`database_name` ≠ the live cluster → `RAISE EXCEPTION` (abort). Prevents applying one DB's artifact to another.
3. **Row-level guard (never clobbers a newer value)** — a row is reverted to `previous_organization_id` **only if** its current `organization_id` still equals `target_organization_id` (i.e. unchanged since 0032). Any row changed after the migration is written to `_rb0032_diverged`, **reported and skipped** — never overwritten.
4. **Idempotent** — after a revert the row holds `previous` (NULL) ≠ `target`, so a second run matches 0 rows.

Alternatives considered: a self-contained pre-image *table* in prod (rejected — lifecycle/drop ownership open), and post-hoc re-derivation (rejected — **unsafe**: a backfilled B1 row is indistinguishable from an always-correct C row, so a blind NULL would clobber C).

Every clause above is proven in the migration test (`rollback contract` describe): B1-only revert, idempotency, and the fail-closed refusal to overwrite a post-migration change (`current != target` → skipped + reported).

## Production Gate — merging this PR does NOT authorize deployment
Merging PR #15 lands the migration file, its rollback, tests, and this runbook on `main` **only**. Because the PR carries `[skip deploy]` and the deploy job is gated to `main` pushes without `[skip deploy]`, **0032 is not applied to any production database by the merge.** Applying 0032 to production is a **separate, explicitly-authorized gate**. Before any production deploy that includes 0032, the operator MUST, in order:

1. Run the **read-only B1/B2/B3/D/E classification** (the Before/report queries above) against production.
2. **Save the report** (the unresolved B2/B3/D/E detail is a Data-Integrity record).
3. Generate the **pre-image artifact** for every targeted B1 row (query above) and store it externally.
4. Take the standard **`pg_dump` backup** per project policy.
5. **Verify the artifact row count == B1 count** from step 1 before deploying.
6. **After deploy:** prove `rows changed == expected B1 count` and that **B2/B3/D/E are unchanged** (re-run the classification; deltas only in B1).

If production reveals **B3 / D / E**, that does **not** block B1 — but those rows are **recorded and NOT repaired by 0032** (a separate, later decision/batch).

## Acceptance criteria (all asserted in the migration test)
- **AC1** B1 rows → `organization_id = project owner`.
- **AC2** exactly the B1 count changed (rowCount == |B1|); pre-image capture == B1 set.
- **AC3** B2 / B3 / C / D / E unchanged.
- **AC4** idempotent — second apply changes 0 rows.
- **AC5** no other column changed (`file_url`/`file_name`/`file_size`/`sha256`/`deleted_at`).
- **AC6** unresolved report classifies B2/B3/D/E with the required columns.

## Out of scope (deferred, per decision)
B2 repair (fix parent `documents.organization_id` from project owner first, then its files), and D/E incident resolution — each a separate batch after review. Not started here.
