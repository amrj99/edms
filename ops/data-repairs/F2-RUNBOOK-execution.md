# F2 — Execution Runbook (operational; NOT part of the frozen package)

The repair package `ops/data-repairs/F2-legacy-storage-path/` is **FROZEN** at
`main @ 8131401`. This runbook adds OPERATIONAL requirements only — it does not
change any package script. Any change to the package itself now requires a NEW
DISCOVERY, not an enhancement.

**Scope reminder:** this runbook covers the production repair (02→03→04→06).
It does **NOT** include cleanup/deletion of `/app/uploads/1/0/` — that stays a
separate, later, independently-approved task.

All commands are owner-run on the VPS (the assistant has no SSH). Each stage is
behind a separate explicit approval.

---

## 0. Pre-execution CHECKPOINT (mandatory — record before anything writes)
Capture and SAVE this block (paste it back for the record):

```bash
cd /var/www/edms/ops/data-repairs/F2-legacy-storage-path
echo "== F2 EXECUTION CHECKPOINT =="
echo "commit      : $(git -C /var/www/edms rev-parse HEAD)"
echo "exec_time   : $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "operator    : ${OPERATOR:-$(whoami)}"     # or: OPERATOR='<name>' before running
echo "-- four unique files: name + SHA256 (from the real physical source /1/0) --"
for f in $(cut -f7 mapping.gen.tsv | sort -u); do
  docker exec edms_api sha256sum "/app/uploads/1/0/document/$f"
done
```
Checkpoint must contain: **commit, exec_time, SHA256 of the 4 files, file names,
operator**. Keep it with the run log.

## 1. Backup + timestamped copies of rollback inputs (before 04_migrate)
```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
# (a) DB backup — the three affected tables (point-in-time safety on top of pre-image)
docker exec edms_postgres pg_dump -U edms -d edms \
  -t document_files -t document_revisions -t correspondence_attachments \
  > "/var/www/edms/ops/data-repairs/F2-backup-3tables-$TS.sql"
# (b) preserve rollback inputs (05_rollback depends on mapping.mig.tsv)
cp mapping.mig.tsv "mapping.mig.$TS.tsv"
cp preimage.tsv    "preimage.$TS.tsv"
echo "backup+snapshots done: TS=$TS"
```
> These artefacts are runtime outputs (gitignored) — they stay on the VPS, not in git.

## 2. Stages (each behind its own approval)
| # | command (from the package dir, APP/DB exported) | gate before next |
|---|---|---|
| 2 | `bash 02_copy.sh`   | "COPY DONE"; pre-scan 4/4 passed |
| 3 | `bash 03_verify.sh` | **VERIFY PASS — 4/4** (size+sha256+cmp+app-readable) |
| 4 | `docker exec -i edms_postgres psql -U edms -d edms -v ON_ERROR_STOP=1 -f - < 04_migrate.sql` | `NOTICE F2 migrate OK (total=7)` + COMMIT |
| — | **post-migrate verify (read-only)** — see §3 | 7 at new_url, 0 at old_url |
| 6 | `BASE_URL/AUTH_TOKEN/OTHER_TOKEN` set → `bash 06_download_and_perms_test.sh` | **DOWNLOAD + ISOLATION PASS — 7/7** |

Stop after stage 6. No `/1/0/` cleanup here.

## 3. Post-migrate verification query (read-only, run after 04)
```bash
docker exec -i edms_postgres psql -U edms -d edms -P pager=off <<'SQL'
SELECT 'still_old' AS check, count(*) FROM (
  SELECT file_url FROM document_files WHERE file_url ~ '^/app/uploads/1/document/[^/]+$'
  UNION ALL SELECT file_url FROM document_revisions WHERE file_url ~ '^/app/uploads/1/document/[^/]+$'
  UNION ALL SELECT file_url FROM correspondence_attachments WHERE file_url ~ '^/app/uploads/1/document/[^/]+$'
) s
UNION ALL
SELECT 'now_new', count(*) FROM (
  SELECT file_url FROM document_files WHERE file_url ~ '^/api/storage/onpremise/1/1/document/[^/]+$'
  UNION ALL SELECT file_url FROM document_revisions WHERE file_url ~ '^/api/storage/onpremise/1/1/document/[^/]+$'
  UNION ALL SELECT file_url FROM correspondence_attachments WHERE file_url ~ '^/api/storage/onpremise/1/1/document/[^/]+$'
) s2;
SQL
```
Expected: `still_old = 0`, and `now_new` ≥ 7 (7 migrated + any already-correct).

## 4. Abort / rollback
- 02/03 fail → nothing written to DB; investigate; safe to re-run.
- 04 raises → transaction ROLLBACK automatic; DB unchanged.
- 06 fails after a successful 04 → run rollback immediately:
  `docker exec -i edms_postgres psql -U edms -d edms -v ON_ERROR_STOP=1 -f - < 05_rollback.sql`
  (uses the same `mapping.mig.tsv`; `/1/0/` originals are intact; `/1/1/` copies remain — harmless).

## 5. Governance
- Package frozen at `8131401`; runbook is operational only.
- Cleanup of `/1/0/` and the unreferenced 5th file: separate tasks, later, separate approval.

## 6. Execution evidence
- 04_migrate executed successfully on production — recorded in
  `ops/data-repairs/F2-EXECUTION-EVIDENCE.md` (repo `8224069`; MIGRATE_EXIT=0,
  POST_VERIFY_EXIT=0, 7 rows now under /api/storage/onpremise/1/1/document/…).
- Not yet run: Post-Repair Functional Validation. Deferred: /1/0 cleanup.

## 7. Post-Repair Functional Validation (06) — tool ready, NOT run
- Hardened one-file runner: `ops/data-repairs/F2-run-06-validation.sh` (merged `6518683`).
- READ-ONLY: authorized download of the 7 links (200 + exact size) + cross-org denial
  (403/404 only); fail-closed; hidden interactive tokens (read -s, curl -K 0600).
- Run (on the VPS) only when the owner decides:
    cd /var/www/edms && git pull --ff-only origin main
    export BASE_URL=https://<host>
    bash ops/data-repairs/F2-run-06-validation.sh   # prompts for AUTH_TOKEN, OTHER_TOKEN (hidden)
  Success = VALIDATION_EXIT=0 + "RESULT: PASS — 7/7". Requires two real sessions
  (org-1 authorized user + a different-org user) supplied by the operator.
