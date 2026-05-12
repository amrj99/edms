#!/bin/bash
# =============================================================================
# pre-deploy-backup.sh — ArcScale EDMS pre-deployment database backup
# =============================================================================
#
# Run this BEFORE every production deployment that includes migrations.
# Referenced in docs/deployment/MIGRATION_GOVERNANCE.md pre-deploy checklist.
#
# Usage:
#   bash /var/www/edms/scripts/pre-deploy-backup.sh
#
# Required environment variables: same as backup.sh (sources /var/www/edms/.env)
# Optional:
#   BACKUP_BUCKET        R2 bucket for backups (default: edms-backups)
#   PRE_DEPLOY_PREFIX    Key prefix for pre-deploy dumps (default: pre-deploy)
#   PRE_DEPLOY_RETAIN_DAYS  Days to keep pre-deploy dumps (default: 30)
#
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/edms-backups"
FILENAME="pre-deploy_edms_${TIMESTAMP}.dump"
TEMP_FILE="${BACKUP_DIR}/${FILENAME}"

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
PRE_DEPLOY_PREFIX="${PRE_DEPLOY_PREFIX:-pre-deploy}"
PRE_DEPLOY_RETAIN_DAYS="${PRE_DEPLOY_RETAIN_DAYS:-30}"
DB_CONTAINER="${DB_CONTAINER:-edms_postgres}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"

echo "[pre-deploy-backup] ── Pre-deployment Backup ── $(date)"

if [ -z "${R2_ENDPOINT:-}" ] || [ -z "${R2_ACCESS_KEY:-}" ] || [ -z "${R2_SECRET_KEY:-}" ]; then
  echo "[pre-deploy-backup] FATAL: R2 credentials not configured. Cannot take pre-deploy backup."
  echo "[pre-deploy-backup] Do NOT proceed with deployment until backup is configured."
  exit 1
fi

if ! command -v aws &> /dev/null; then
  echo "[pre-deploy-backup] FATAL: aws CLI not found. Install: apt-get install -y awscli"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "[pre-deploy-backup] FATAL: '${DB_CONTAINER}' is not running."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[pre-deploy-backup] Dumping '${DB_NAME}'..."

docker exec "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" \
  --format=custom \
  --compress=9 \
  --no-password \
  "$DB_NAME" > "$TEMP_FILE"

DUMP_SIZE=$(du -h "$TEMP_FILE" | cut -f1)
echo "[pre-deploy-backup] Dump complete: ${FILENAME} (${DUMP_SIZE})"

echo "[pre-deploy-backup] Uploading to R2..."

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
aws s3 cp \
  "$TEMP_FILE" \
  "s3://${BACKUP_BUCKET}/${PRE_DEPLOY_PREFIX}/${FILENAME}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --no-progress \
  --region auto

echo "[pre-deploy-backup] Uploaded: s3://${BACKUP_BUCKET}/${PRE_DEPLOY_PREFIX}/${FILENAME}"

rm -f "$TEMP_FILE"

# Prune old pre-deploy backups
if date -d "1 day ago" &>/dev/null 2>&1; then
  CUTOFF=$(date -d "${PRE_DEPLOY_RETAIN_DAYS} days ago" +%Y%m%d)
else
  CUTOFF=$(date -v-${PRE_DEPLOY_RETAIN_DAYS}d +%Y%m%d)
fi

PRUNED=0
while IFS= read -r f; do
  fdate=$(echo "$f" | grep -oE '[0-9]{8}' | head -1 || true)
  if [ -n "$fdate" ] && [ "$fdate" -lt "$CUTOFF" ] 2>/dev/null; then
    AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
    AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
    aws s3 rm \
      "s3://${BACKUP_BUCKET}/${PRE_DEPLOY_PREFIX}/${f}" \
      --endpoint-url "${R2_ENDPOINT}" \
      --region auto
    PRUNED=$((PRUNED + 1))
  fi
done < <(
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
  aws s3 ls \
    "s3://${BACKUP_BUCKET}/${PRE_DEPLOY_PREFIX}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --region auto \
  | awk '{print $4}' \
  | grep -E '^pre-deploy_edms_[0-9]' || true
)

[ "$PRUNED" -gt 0 ] && echo "[pre-deploy-backup] Pruned ${PRUNED} old pre-deploy backup(s)."

echo "[pre-deploy-backup] ── Complete: $(date) ──"
echo "[pre-deploy-backup] Safe to proceed with deployment."
