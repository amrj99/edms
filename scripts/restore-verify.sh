#!/bin/bash
# =============================================================================
# restore-verify.sh — ArcScale EDMS backup restore verification drill
# =============================================================================
#
# Run this monthly (during beta) or weekly (after beta, with paying clients).
# Restores the latest nightly backup to a throwaway container and verifies
# row counts match the live database within an acceptable margin.
#
# Usage:
#   bash /var/www/edms/scripts/restore-verify.sh
#
# This script is SAFE to run on a live VPS — it uses a different port (5433)
# and a throwaway container that is removed at the end.
#
# Required: same R2 credentials as backup.sh
# Optional:
#   BACKUP_BUCKET     R2 bucket (default: edms-backups)
#   BACKUP_PREFIX     Key prefix (default: nightly)
#   TEST_PORT         Local port for the test container (default: 5433)
#   TEST_PG_PASSWORD  Postgres password for test container (default: test_restore_only)
#
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-nightly}"
TEST_PORT="${TEST_PORT:-5433}"
TEST_PG_PASSWORD="${TEST_PG_PASSWORD:-test_restore_only}"
DB_CONTAINER="${DB_CONTAINER:-edms_postgres}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"
RESTORE_CONTAINER="edms_restore_test_$$"
TEMP_FILE="/tmp/edms_restore_test_$$.dump"

cleanup() {
  echo "[restore-verify] Cleaning up..."
  docker stop "$RESTORE_CONTAINER" 2>/dev/null || true
  docker rm "$RESTORE_CONTAINER" 2>/dev/null || true
  rm -f "$TEMP_FILE"
  echo "[restore-verify] Cleanup done."
}
trap cleanup EXIT

echo "[restore-verify] ── Restore Verification Drill ── $(date)"

if [ -z "${R2_ENDPOINT:-}" ] || [ -z "${R2_ACCESS_KEY:-}" ] || [ -z "${R2_SECRET_KEY:-}" ]; then
  echo "[restore-verify] FATAL: R2 credentials not configured."
  exit 1
fi

# ── Find the latest backup ────────────────────────────────────────────────────

echo "[restore-verify] Finding latest backup in R2..."

LATEST_FILE=$(
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
  aws s3 ls \
    "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --region auto \
  | awk '{print $4}' \
  | grep -E '^edms_[0-9]' \
  | sort \
  | tail -1
)

if [ -z "$LATEST_FILE" ]; then
  echo "[restore-verify] FATAL: No backups found in s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/"
  exit 1
fi

echo "[restore-verify] Latest backup: ${LATEST_FILE}"

# ── Download backup ───────────────────────────────────────────────────────────

echo "[restore-verify] Downloading..."

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
aws s3 cp \
  "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${LATEST_FILE}" \
  "$TEMP_FILE" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto

DUMP_SIZE=$(du -h "$TEMP_FILE" | cut -f1)
echo "[restore-verify] Downloaded: ${DUMP_SIZE}"

# ── Start throwaway postgres container ────────────────────────────────────────

echo "[restore-verify] Starting test container on port ${TEST_PORT}..."

docker run -d \
  --name "$RESTORE_CONTAINER" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$TEST_PG_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "${TEST_PORT}:5432" \
  postgres:16-alpine

echo "[restore-verify] Waiting for test container to be ready..."
WAIT=0
until docker exec "$RESTORE_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; do
  sleep 1
  WAIT=$((WAIT + 1))
  if [ "$WAIT" -gt 30 ]; then
    echo "[restore-verify] FATAL: Test container did not become ready in 30 seconds."
    exit 1
  fi
done
echo "[restore-verify] Test container ready."

# ── Restore ───────────────────────────────────────────────────────────────────

echo "[restore-verify] Restoring dump..."

PGPASSWORD="$TEST_PG_PASSWORD" pg_restore \
  --host=127.0.0.1 \
  --port="$TEST_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-password \
  --verbose \
  "$TEMP_FILE" 2>&1 | tail -5

echo "[restore-verify] Restore complete."

# ── Verify row counts ─────────────────────────────────────────────────────────

echo "[restore-verify] Verifying row counts..."

count_live() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM $1;" 2>/dev/null | tr -d ' '
}

count_restored() {
  PGPASSWORD="$TEST_PG_PASSWORD" psql \
    --host=127.0.0.1 \
    --port="$TEST_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-password \
    -t -c "SELECT COUNT(*) FROM $1;" 2>/dev/null | tr -d ' '
}

PASS=true
for TABLE in users organizations documents projects audit_logs; do
  LIVE=$(count_live "$TABLE")
  RESTORED=$(count_restored "$TABLE")
  if [ "$LIVE" = "$RESTORED" ]; then
    echo "[restore-verify]   $TABLE: ${RESTORED} rows (MATCH)"
  else
    # Allow the restored count to be <= live (live may have had activity since backup)
    if [ "$RESTORED" -le "$LIVE" ] 2>/dev/null; then
      DIFF=$((LIVE - RESTORED))
      echo "[restore-verify]   $TABLE: restored=${RESTORED}, live=${LIVE} (+${DIFF} since backup — acceptable)"
    else
      echo "[restore-verify]   FAIL: $TABLE: restored=${RESTORED} > live=${LIVE} — UNEXPECTED"
      PASS=false
    fi
  fi
done

echo ""
if [ "$PASS" = "true" ]; then
  echo "[restore-verify] ✓ PASS — Restore verification successful."
  echo "[restore-verify]   Backup from ${LATEST_FILE} restores correctly."
  echo "[restore-verify]   Record this result in docs/operations/"
else
  echo "[restore-verify] ✗ FAIL — Restore verification failed. Investigate before relying on this backup."
  exit 1
fi

echo "[restore-verify] ── Done: $(date) ──"
