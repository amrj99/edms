# F2 — Production Execution Evidence (documentation only)

Immutable record of the F2 legacy storage-path data repair as executed on
production. Documentation only — no operational script is modified by this file.

## Stage: 02_copy (files copied /1/0 → /1/1)
- Result: `COPY DONE` — 4/4 unique files copied (Copy not Move); sources intact.

## Stage: 03_verify (post-copy integrity)
- Result: `VERIFY PASS — 4/4` (size + sha256 + cmp + app-readable as real runtime uid `root`).
- Note: verified with `APP_UID=root` (documented runbook override = actual runtime identity;
  app process runs as root — see provenance investigation). Package unchanged.

## Stage: 04_migrate (DB file_url old → new) — SUCCESS
- **Recorded:** 2026-07-20
- **Repo state at execution:** `main` pulled to merge SHA `8224069` (F2 one-file runner;
  includes the compile-fix `ead4556` and canonical-contract package).
- **Runner:** `ops/data-repairs/F2-run-04-migrate.sh` (approved wrapper verbatim).
- **Container / DB / identity:** `edms_postgres` / `edms` / `edms`.
- **Mapping integrity:** `mapping.mig.tsv` rows = 7; host↔container SHA256 match =
  `4aa51b2e9c5240282411351b6dd3ba93f3f18655fbc791fbf1f0d283949a1d61`.
- **Migrate:** `MIGRATE_EXIT=0`; `NOTICE: F2 migrate OK: df=2, dr=4, ca=1 (total=7)`; `COMMIT`.
- **Post-verify (fail-closed asserts):** `POST_VERIFY_EXIT=0`;
  `NOTICE: POST-VERIFY OK: map=7, now_new=7, still_old=0, offending=0, per_table df=2/dr=4/ca=1`;
  OFFENDING_ROW = 0 rows.
- **Result:** all 7 target rows now serve under `/api/storage/onpremise/1/1/document/...`.
- **WRAPPER_EXIT=0.**

## Preserved (not touched)
- Physical source copies remain at `/app/uploads/1/0/document/` (Copy not Move — never deleted).
- Backup + timestamped rollback inputs: `ops/data-repairs/F2-exec-artifacts-20260719T141530Z/`
  (`backup-3tables.sql`, `mapping.mig.tsv`, `preimage.tsv`).
- `05_rollback.sql` available and compile-proven; NOT run.

## Still open (post-04)
- `06_download_and_perms_test.sh` — end-to-end retrieval + cross-org isolation check (not run yet).
- Deferred cleanup of the old `/1/0/` copies — separate task, separate approval (see 07 plan).
- Unreferenced 5th file `1777805805230_Code_of_Conduct` — separate observation.
