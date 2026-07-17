#!/usr/bin/env bash
# =============================================================================
# backfill-docs-org-drill.sh — REAL-restore drill for the documents-org backfill
# =============================================================================
# Restores the latest nightly backup into a THROWAWAY container and runs the full
# backfill package against that real data: baseline -> pre-image -> forward ->
# verify -> 0032 -> verify -> rollback -> verify. Zero production impact: the live
# edms_postgres container is never touched.
#
# Usage (on the VPS, from the repo root):  bash scripts/ops/backfill-docs-org-drill.sh
# Requires the same R2 credentials as backup.sh / restore-verify.sh.
# =============================================================================
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-nightly}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"
TEST_PORT="${TEST_PORT:-5434}"
TEST_PW="${TEST_PW:-backfill_drill_only}"
C="edms_backfill_drill_$$"
C2="edms_backfill_drill_other_$$"   # a genuinely separate database for the identity test
TMP="/tmp/edms_backfill_drill_$$.dump"
HOST_CSV="/tmp/_bf_drill_preimage_$$.csv"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FWD="$REPO/lib/db/drizzle/manual_backfill_documents_org_from_project.sql"
RBK="$REPO/lib/db/drizzle/rollback_backfill_documents_org_from_project.sql"
M0032="$REPO/lib/db/drizzle/0032_backfill_document_files_org_id.sql"

cleanup(){
  docker stop "$C" "$C2" >/dev/null 2>&1 || true
  docker rm   "$C" "$C2" >/dev/null 2>&1 || true
  rm -f "$TMP" "$HOST_CSV" || true
}
trap cleanup EXIT

log(){ printf '[bf-drill] %s\n' "$*"; }
# Any safety-check failure ends the drill immediately with a non-zero status.
fail(){ log "DRILL RESULT: FAIL — $*"; exit 1; }
psqc(){ docker exec -e PGPASSWORD="$TEST_PW" -i "$C" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" "$@"; }
psqc2(){ docker exec -e PGPASSWORD="$TEST_PW" -i "$C2" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

[ -f "$FWD" ] && [ -f "$RBK" ] && [ -f "$M0032" ] || { echo "SQL files missing — checkout the branch first."; exit 1; }
[ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_ACCESS_KEY:-}" ] && [ -n "${R2_SECRET_KEY:-}" ] || { echo "R2 creds not set."; exit 1; }

log "Finding + downloading latest backup..."
LATEST=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
  aws s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" --endpoint-url "$R2_ENDPOINT" --region auto \
  | awk '{print $4}' | grep -E '^edms_[0-9]' | sort | tail -1)
[ -n "$LATEST" ] || { echo "No backup found."; exit 1; }
log "Latest: $LATEST"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
  aws s3 cp "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${LATEST}" "$TMP" --endpoint-url "$R2_ENDPOINT" --region auto >/dev/null
log "Downloaded ($(du -h "$TMP" | cut -f1))."

log "Starting throwaway container on port ${TEST_PORT}..."
docker run -d --name "$C" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$TEST_PW" -e POSTGRES_DB="$DB_NAME" -p "${TEST_PORT}:5432" postgres:16-alpine >/dev/null
W=0; until docker exec -e PGPASSWORD="$TEST_PW" "$C" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; do sleep 1; W=$((W+1)); [ "$W" -gt 60 ] && { echo "container not ready"; exit 1; }; done
log "Restoring dump..."
docker exec -i -e PGPASSWORD="$TEST_PW" "$C" pg_restore -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" --no-password < "$TMP" 2>&1 | tail -2 || true

echo; log "===== BASELINE ====="
psqc -c "SELECT (SELECT count(*) FROM documents) docs,
 (SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL) null_owned_docs,
 (SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NULL) null_ownerless_docs,
 (SELECT count(*) FROM document_files) files,
 (SELECT count(*) FROM document_files WHERE organization_id IS NULL) null_files;"
BASE_NULL=$(psqc -tAc "SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL" | tr -d '[:space:]')
log "captured BASELINE null_owned_docs = $BASE_NULL"

echo; log "===== PRE-IMAGE (read-only) ====="
psqc -tAc "COPY ( SELECT 'doc' AS kind, d.id AS row_id, d.organization_id AS previous_org, p.organization_id AS target_org, current_database() AS database_name, (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier, now()::text AS captured_at FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'file', df.id, df.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id WHERE df.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'rev', r.id, r.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_revisions r JOIN documents d ON d.id=r.document_id JOIN projects p ON p.id=d.project_id WHERE r.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL ) TO STDOUT WITH CSV HEADER" > "$HOST_CSV"
log "pre-image rows: $(($(wc -l < "$HOST_CSV")-1))"; tail -n +2 "$HOST_CSV" | cut -d, -f1 | sort | uniq -c

echo; log "===== FORWARD ====="
psqc -v ON_ERROR_STOP=1 < "$FWD"

echo; log "===== POST-FORWARD VERIFY ====="
psqc -c "SELECT count(*) FILTER (WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL) null_owned_docs_remaining,
 count(*) FILTER (WHERE d.organization_id IS DISTINCT FROM p.organization_id AND d.organization_id IS NOT NULL) doc_owner_mismatch
 FROM documents d JOIN projects p ON p.id=d.project_id;"
PF_NULL=$(psqc -tAc "SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL" | tr -d '[:space:]')
PF_MIS=$(psqc -tAc "SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS DISTINCT FROM p.organization_id AND d.organization_id IS NOT NULL" | tr -d '[:space:]')
[ "$PF_NULL" = "0" ] || fail "post-forward null_owned_docs=$PF_NULL (expected 0)"
[ "$PF_MIS" = "0" ]  || fail "post-forward doc_owner_mismatch=$PF_MIS (expected 0)"

echo; log "===== 0032 AFTER BACKFILL (rows it still backfills, and why) ====="
psqc -v ON_ERROR_STOP=1 < "$M0032"
psqc -c "SELECT count(*) FILTER (WHERE organization_id IS NULL) files_still_null FROM document_files;"

echo; log "===== ROLLBACK (clean) — full revert to baseline ====="
docker cp "$HOST_CSV" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null
psqc -v ON_ERROR_STOP=1 < "$RBK"
CR_NULL=$(psqc -tAc "SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL" | tr -d '[:space:]')
log "null_owned_docs_after_clean_rollback=$CR_NULL (baseline was $BASE_NULL)"
[ "$CR_NULL" = "$BASE_NULL" ] || fail "clean rollback did not fully revert ($CR_NULL != baseline $BASE_NULL)"

echo; log "===== DIVERGED-ROW behavior ====="
# Re-apply forward, change ONE backfilled doc to an EXISTING different org (FK-safe),
# then roll back: that row must be SKIPPED (kept) while a control row reverts to NULL.
psqc -v ON_ERROR_STOP=1 < "$FWD" >/dev/null
DIV=$(awk -F, '$1=="doc"{print $2; exit}' "$HOST_CSV")
CTL=$(awk -F, '$1=="doc"{c++; if(c==2){print $2; exit}}' "$HOST_CSV")
DIV_TARGET=$(awk -F, -v d="$DIV" '$1=="doc" && $2==d {print $4; exit}' "$HOST_CSV")
ALT=$(psqc -tAc "SELECT id FROM organizations WHERE id <> ${DIV_TARGET} ORDER BY id LIMIT 1" | tr -d '[:space:]')
[ -n "$ALT" ] || fail "diverged test: no existing organization <> ${DIV_TARGET} to diverge to"
log "diverging doc $DIV from org ${DIV_TARGET} to existing org ${ALT} (FK-safe)"
psqc -c "UPDATE documents SET organization_id=${ALT} WHERE id=$DIV;" >/dev/null
docker cp "$HOST_CSV" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null
psqc -v ON_ERROR_STOP=1 < "$RBK"
DIV_NOW=$(psqc -tAc "SELECT organization_id FROM documents WHERE id=$DIV" | tr -d '[:space:]')
CTL_NOW=$(psqc -tAc "SELECT COALESCE(organization_id::text,'NULL') FROM documents WHERE id=$CTL" | tr -d '[:space:]')
log "diverged_doc=$DIV_NOW (expect $ALT, kept) ; control_doc=$CTL_NOW (expect NULL, reverted)"
[ "$DIV_NOW" = "$ALT" ]   || fail "diverged row was NOT skipped (org=$DIV_NOW, expected kept at $ALT)"
[ "$CTL_NOW" = "NULL" ]   || fail "control row did not revert to NULL (org=$CTL_NOW)"

echo; log "===== WRONG-DATABASE-IDENTITY behavior (a GENUINELY different database) ====="
# Not a text edit: spin a SECOND, independent postgres (its own initdb => its own
# system_identifier) and try to use the artifact CAPTURED ON THE RESTORED DB there.
# The rollback's identity guard (checks BOTH database_name AND system_identifier)
# must ABORT and change nothing.
docker run -d --name "$C2" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$TEST_PW" -e POSTGRES_DB="$DB_NAME" postgres:16-alpine >/dev/null
W=0; until docker exec -e PGPASSWORD="$TEST_PW" "$C2" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; do sleep 1; W=$((W+1)); [ "$W" -gt 60 ] && fail "second container not ready"; done
# Minimal empty target tables so the identity guard (which runs first) is
# unambiguously what stops the rollback.
psqc2 -q -c "CREATE TABLE documents(id int, organization_id int); CREATE TABLE document_files(id int, organization_id int); CREATE TABLE document_revisions(id int, organization_id int);"
SID1=$(psqc  -tAc "SELECT system_identifier FROM pg_control_system()" | tr -d '[:space:]')
SID2=$(psqc2 -tAc "SELECT system_identifier FROM pg_control_system()" | tr -d '[:space:]')
log "restored-DB system_identifier=$SID1 ; other-DB system_identifier=$SID2"
[ "$SID1" != "$SID2" ] || fail "the two databases share a system_identifier (cannot test identity guard)"
docker cp "$HOST_CSV" "$C2:/tmp/_rb_backfill_docs_org.csv" >/dev/null
OUT=$(psqc2 < "$RBK" 2>&1 || true)
if printf '%s' "$OUT" | grep -qiE "ABORT: artifact DB identity"; then
  log "RESULT: ABORT on the other database as expected — the artifact is bound to its origin DB."
else
  printf '%s\n' "$OUT" | tail -5
  fail "rollback did NOT abort on a different database — artifact is NOT DB-bound (SAFETY FAILURE)"
fi

echo; log "===== CLEANUP (both throwaway containers removed) ====="
cleanup
log "cleanup done."

echo; log "DRILL RESULT: PASS"
