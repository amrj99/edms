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
TMP="/tmp/edms_backfill_drill_$$.dump"
HOST_CSV="/tmp/_bf_drill_preimage_$$.csv"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FWD="$REPO/lib/db/drizzle/manual_backfill_documents_org_from_project.sql"
RBK="$REPO/lib/db/drizzle/rollback_backfill_documents_org_from_project.sql"
M0032="$REPO/lib/db/drizzle/0032_backfill_document_files_org_id.sql"

cleanup(){ docker stop "$C" >/dev/null 2>&1 || true; docker rm "$C" >/dev/null 2>&1 || true; rm -f "$TMP" "$HOST_CSV" "${HOST_CSV}.c" || true; }
trap cleanup EXIT

log(){ printf '[bf-drill] %s\n' "$*"; }
psqc(){ docker exec -e PGPASSWORD="$TEST_PW" -i "$C" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

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

echo; log "===== PRE-IMAGE (read-only) ====="
psqc -tAc "COPY ( SELECT 'doc' AS kind, d.id AS row_id, d.organization_id AS previous_org, p.organization_id AS target_org, current_database() AS database_name, (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier, now()::text AS captured_at FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'file', df.id, df.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id WHERE df.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'rev', r.id, r.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_revisions r JOIN documents d ON d.id=r.document_id JOIN projects p ON p.id=d.project_id WHERE r.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL ) TO STDOUT WITH CSV HEADER" > "$HOST_CSV"
log "pre-image rows: $(($(wc -l < "$HOST_CSV")-1))"; tail -n +2 "$HOST_CSV" | cut -d, -f1 | sort | uniq -c

echo; log "===== FORWARD ====="
psqc -v ON_ERROR_STOP=1 < "$FWD"

echo; log "===== POST-FORWARD VERIFY ====="
psqc -c "SELECT count(*) FILTER (WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL) null_owned_docs_remaining,
 count(*) FILTER (WHERE d.organization_id IS DISTINCT FROM p.organization_id AND d.organization_id IS NOT NULL) doc_owner_mismatch
 FROM documents d JOIN projects p ON p.id=d.project_id;"

echo; log "===== 0032 AFTER BACKFILL (rows it still backfills, and why) ====="
psqc -v ON_ERROR_STOP=1 < "$M0032"
psqc -c "SELECT count(*) FILTER (WHERE organization_id IS NULL) files_still_null FROM document_files;"

echo; log "===== ROLLBACK (clean) — full revert to baseline ====="
docker cp "$HOST_CSV" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null
psqc -v ON_ERROR_STOP=1 < "$RBK"
psqc -c "SELECT count(*) FILTER (WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL) null_owned_docs_after_clean_rollback FROM documents d JOIN projects p ON p.id=d.project_id;"
log "(should equal the BASELINE null_owned_docs above — full revert)"

echo; log "===== DIVERGED-ROW behavior ====="
# Re-apply forward, change ONE backfilled doc, then roll back: that row must be
# SKIPPED (still != NULL) while a control row reverts to NULL.
psqc -v ON_ERROR_STOP=1 < "$FWD" >/dev/null
DIV=$(awk -F, '$1=="doc"{print $2; exit}' "$HOST_CSV")
CTL=$(awk -F, '$1=="doc"{c++; if(c==2){print $2; exit}}' "$HOST_CSV")
psqc -c "UPDATE documents SET organization_id=999999 WHERE id=$DIV;" >/dev/null
docker cp "$HOST_CSV" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null
psqc -v ON_ERROR_STOP=1 < "$RBK"
psqc -c "SELECT (SELECT organization_id FROM documents WHERE id=$DIV) AS diverged_doc, (SELECT organization_id FROM documents WHERE id=$CTL) AS control_doc;"
log "EXPECT diverged_doc=999999 (skipped/reported), control_doc=NULL (reverted)"

echo; log "===== WRONG-DATABASE-IDENTITY behavior ====="
# Tamper the artifact's system_identifier (the 15+ digit field) -> must ABORT.
sed 's/,[0-9]\{15,\},/,9999999999999999,/' "$HOST_CSV" > "${HOST_CSV}.c"
docker cp "${HOST_CSV}.c" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null
if psqc < "$RBK" 2>&1 | grep -qiE "ABORT: artifact DB identity"; then
  log "RESULT: ABORT as expected (identity mismatch rejected — no rows changed)"
else
  log "RESULT: NO ABORT — INVESTIGATE"
fi

echo; log "===== DONE (throwaway torn down; production untouched) ====="
