# Migration 0032 — Owner-Run Production Gate (runbook)

> **Scope:** the exact, low-human-error procedure the **owner** runs on the VPS to complete the
> 0032 Production Gate. Claude has **no VPS access**, so these are owner-run tools. **Nothing here
> lifts the Production Hold, executes 0032, or deploys.** Execution (§C) and lifting the Hold require
> a separate, explicit owner approval after the read-only results are reviewed.
>
> Sequence: **read-only gate → send results → Claude analyses → backup + restore drill → owner
> approval → execute → verify → lift Hold → tag → deploy → health/UAT → rollback if needed.**

## Tools (in `scripts/ops/`)
| Script | What it does | Writes? |
|--------|--------------|---------|
| `_0032-common.sh` | shared discovery (verifies container/db, prints DB identity) + helpers | no |
| `0032-gate-readonly.sh` | A1–A4 read-only checks → dated results folder + tarball | **no** (SELECT/EXPLAIN plan/COPY TO STDOUT only; CI-guarded) |
| `0032-backup-verify.sh` | pg_dump→R2, files→R2, restore-verify drill, pre-image artifact | backups only |
| `0032-rollback.sh` | targeted 0032 data rollback (fail-closed), `--dry-run` preview | reverts data (real mode) |

**Discovery, no guessing:** every script verifies the container + DB (env overrides
`DB_CONTAINER`/`DB_USER`/`DB_NAME`) and **STOPS** if names/paths don't match — it never assumes
`edms_postgres`/`edms`/`/var/www/edms`.

## The single command you run first (READ-ONLY)
```bash
cd /path/to/your/edms/checkout
bash scripts/ops/0032-gate-readonly.sh
```
It prints one tarball path (e.g. `~/0032-gate/<utc>.tar.gz`). **Send that one file back for analysis.**
It contains: `A1_classification.txt`, `A2_unresolved.txt`, `A3_db_identity.txt`, `A4_explain_plan.txt`,
`SHA256SUMS.txt`, `ATTESTATION.txt` (`NO PRODUCTION DATA WAS MODIFIED`).

## After analysis — backup + restore drill (owner-run)
```bash
bash scripts/ops/0032-backup-verify.sh
```
Produces the pg_dump (→R2), the files mirror (→R2), a **restore-verify PASS** (throwaway container,
not prod), and the **pre-image artifact CSV**. **The pre-image row count MUST equal `b1` from A1.**

## 🔴 Execution (§C) — FORBIDDEN until explicit approval + Hold lift
Do **not** run until: A+B done, artifact rows == B1, restore drill PASS, B3/D/E reviewed and accepted,
and you approve. Apply in one transaction:
```bash
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction \
  < lib/db/drizzle/0032_backfill_document_files_org_id.sql
```
Then re-run `0032-gate-readonly.sh`: only `b1` should have moved (→0); `b2/b3/c/d/e` unchanged.

## Rollback (data) — 0032 only
Code rollback (git tag/commit) does **not** revert a data migration; use the pre-image:
```bash
# preview (reverts nothing):
bash scripts/ops/0032-rollback.sh --dry-run <pre-image.csv>
# real (typed confirmation required):
bash scripts/ops/0032-rollback.sh <pre-image.csv>
```
Fail-closed: aborts on empty artifact or DB-identity mismatch; **skips (never overwrites) any row
changed since 0032** (reported in `_rb0032_diverged`). Backstop = restore the full pg_dump.

### Rollback test plan (MUST pass before any production rollback is considered valid)
The rollback tool is **prepared but not validated** until drilled on a **restored copy**:
1. `bash scripts/ops/restore-verify.sh` (or restore the latest dump) → a throwaway container on `:5433`.
2. Point the tools at it: `export DB_CONTAINER=<test-container-name>` (and matching `DB_USER`/`DB_NAME`).
3. Apply 0032 there (the §C command against the test container).
4. Capture a pre-image on the test container (`0032-backup-verify.sh` B3 step, or the COPY query).
5. `bash scripts/ops/0032-rollback.sh --dry-run <csv>` → review `would_revert` + DIVERGED.
6. `bash scripts/ops/0032-rollback.sh <csv>` → then re-run the classification: **B1 reverted to NULL,
   B2/B3/C/D/E unchanged.** Only after this drill passes is the rollback path accepted.

## Conditions
- **Safe to execute** only when: A1 obtained + A2 saved; A3 identity recorded; B1 dump done; **B2
  restore drill PASS**; **pre-image rows == b1**; rollback drilled on a restored copy; owner approval.
- **STOP** if: restore drill fails · artifact count ≠ b1 · any DB-identity mismatch · container is not
  the true prod DB.
- **Needs owner decision:** any non-zero **B3/D/E** (not repaired by 0032 — a Data-Integrity record);
  an unexpected B1/total ratio or EXPLAIN plan.

## What is guaranteed automatically
`artifacts/api-server/src/test/ops-0032-readonly-guard.test.ts` fails CI if
`0032-gate-readonly.sh` ever contains an executed mutation/DDL, an `EXPLAIN ANALYZE`, or a
`COPY ... FROM`.
