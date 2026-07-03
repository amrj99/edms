#!/bin/bash
# =============================================================================
# backup.sh — ArcScale EDMS nightly PostgreSQL backup to Cloudflare R2
# =============================================================================
#
# Usage:
#   bash /var/www/edms/scripts/backup.sh
#
# Cron (run as root or the deploy user, 02:00 nightly):
#   0 2 * * * /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1
#
# Prerequisites on the VPS:
#   apt-get install -y awscli     (provides the `aws` CLI used for R2 upload)
#   docker must be running edms_postgres
#
# Required environment variables (set in /var/www/edms/.env or exported):
#   R2_ENDPOINT       Cloudflare R2 endpoint, e.g. https://<account>.r2.cloudflarestorage.com
#   R2_ACCESS_KEY     R2 access key ID
#   R2_SECRET_KEY     R2 secret access key
#
# Optional environment variables:
#   BACKUP_BUCKET     R2 bucket for backups (default: edms-backups)
#                     This should be a SEPARATE bucket from the file storage bucket.
#   BACKUP_PREFIX     Key prefix inside the bucket (default: nightly)
#   BACKUP_RETAIN_DAYS  Days to keep backups (default: 90)
#   HEALTHCHECK_URL   healthchecks.io ping URL — pinged on success for dead-man monitoring
#                     Get this from https://healthchecks.io after creating a check
#   DB_CONTAINER      Docker container name for postgres (default: edms_postgres)
#   DB_USER           PostgreSQL user (default: edms)
#   DB_NAME           PostgreSQL database name (default: edms)
#   ENV_FILE          Path to .env file to source (default: /var/www/edms/.env)
#
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/edms-backups"
FILENAME="edms_${TIMESTAMP}.dump"
TEMP_FILE="${BACKUP_DIR}/${FILENAME}"

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-nightly}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-90}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
DB_CONTAINER="${DB_CONTAINER:-edms_postgres}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"

# ── Pre-flight checks ─────────────────────────────────────────────────────────

echo "[backup] ── ArcScale EDMS Backup ── $(date)"

if [ -z "${R2_ENDPOINT:-}" ] || [ -z "${R2_ACCESS_KEY:-}" ] || [ -z "${R2_SECRET_KEY:-}" ]; then
  echo "[backup] FATAL: R2 credentials not configured."
  echo "[backup]   Required: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY"
  echo "[backup]   Set these in ${ENV_FILE} or export them before running."
  exit 1
fi

if ! command -v aws &> /dev/null; then
  echo "[backup] FATAL: aws CLI not found. Install with: apt-get install -y awscli"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "[backup] FATAL: Docker container '${DB_CONTAINER}' is not running."
  echo "[backup]   Check with: docker ps | grep ${DB_CONTAINER}"
  exit 1
fi

# ── Create dump ───────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[backup] Dumping database '${DB_NAME}' from container '${DB_CONTAINER}'..."

docker exec "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" \
  --format=custom \
  --compress=9 \
  --no-password \
  "$DB_NAME" > "$TEMP_FILE"

DUMP_SIZE=$(du -h "$TEMP_FILE" | cut -f1)
echo "[backup] Dump complete: ${FILENAME} (${DUMP_SIZE})"

# ── Upload to R2 ──────────────────────────────────────────────────────────────

echo "[backup] Uploading to R2 bucket '${BACKUP_BUCKET}/${BACKUP_PREFIX}/'..."

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
aws s3 cp \
  "$TEMP_FILE" \
  "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${FILENAME}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --no-progress \
  --region auto

echo "[backup] Upload complete: s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${FILENAME}"

# ── Remove local temp file ────────────────────────────────────────────────────

rm -f "$TEMP_FILE"
echo "[backup] Local temp file removed."

# ── Prune old backups ─────────────────────────────────────────────────────────

echo "[backup] Pruning backups older than ${BACKUP_RETAIN_DAYS} days..."

# date -d works on Linux; date -v on macOS — support both
if date -d "1 day ago" &>/dev/null 2>&1; then
  CUTOFF=$(date -d "${BACKUP_RETAIN_DAYS} days ago" +%Y%m%d)
else
  CUTOFF=$(date -v-${BACKUP_RETAIN_DAYS}d +%Y%m%d)
fi

PRUNED=0
while IFS= read -r f; do
  # Extract date from filename: edms_YYYYMMDD_HHMMSS.dump
  fdate=$(echo "$f" | grep -oE '[0-9]{8}' | head -1 || true)
  if [ -n "$fdate" ] && [ "$fdate" -lt "$CUTOFF" ] 2>/dev/null; then
    AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
    AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
    aws s3 rm \
      "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${f}" \
      --endpoint-url "${R2_ENDPOINT}" \
      --region auto
    echo "[backup] Pruned: ${f}"
    PRUNED=$((PRUNED + 1))
  fi
done < <(
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
  aws s3 ls \
    "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --region auto \
  | awk '{print $4}' \
  | grep -E '^edms_[0-9]' || true
)

echo "[backup] Pruned ${PRUNED} old backup(s)."

# ── Healthchecks.io ping ──────────────────────────────────────────────────────

if [ -n "${HEALTHCHECK_URL}" ]; then
  if curl -fsS --retry 3 --max-time 10 "${HEALTHCHECK_URL}" > /dev/null; then
    echo "[backup] Dead-man ping sent: ${HEALTHCHECK_URL}"
  else
    echo "[backup] WARN: Failed to ping healthchecks.io — backup monitoring may not register success."
  fi
else
  echo "[backup] WARN: HEALTHCHECK_URL not set. Set it to enable backup failure alerting."
  echo "[backup]   Get a free URL from https://healthchecks.io"
fi

# ── Backup uploaded files ─────────────────────────────────────────────────────
# Run immediately after DB dump to minimise the DB / file consistency window.
# Failure is non-fatal: DB backup is already safe in R2 at this point.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if bash "${SCRIPT_DIR}/backup-files.sh"; then
  echo "[backup] File backup complete."
else
  echo "[backup] WARN: File backup failed — DB backup succeeded but files were not synced to R2."
  echo "[backup]   Investigate and run manually: bash ${SCRIPT_DIR}/backup-files.sh"
fi

echo "[backup] ── Done: $(date) ──"
