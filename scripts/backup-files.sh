#!/bin/bash
# =============================================================================
# backup-files.sh — ArcScale EDMS nightly on-premise file backup to Cloudflare R2
# =============================================================================
#
# Syncs the uploads_data Docker volume to Cloudflare R2.
#
# IMPORTANT — No deletion propagation (v1 / Sprint C-1 policy):
#   --delete is intentionally omitted. Files removed from the VPS are retained
#   in R2. This is a safe accumulating mirror. Cleanup policy and R2 versioning
#   will be defined in a future sprint.
#
# Usage:
#   bash /var/www/edms/scripts/backup-files.sh
#
# Called automatically by backup.sh immediately after the DB dump.
# May also be run standalone for testing or manual sync.
#
# Prerequisites on the VPS:
#   apt-get install -y awscli     (same as backup.sh)
#   Docker volume edms_uploads_data must exist (created by docker compose up)
#
# Required environment variables (set in /var/www/edms/.env or exported):
#   R2_ENDPOINT       Cloudflare R2 endpoint, e.g. https://<account>.r2.cloudflarestorage.com
#   R2_ACCESS_KEY     R2 access key ID
#   R2_SECRET_KEY     R2 secret access key
#
# Optional environment variables:
#   BACKUP_BUCKET        R2 bucket for backups (default: edms-backups)
#                        Same bucket as backup.sh — files go under a separate prefix.
#   FILES_PREFIX         R2 key prefix for file mirror (default: files-mirror)
#   UPLOADS_VOLUME_DIR   Local path to Docker volume data
#                        (default: /var/lib/docker/volumes/edms_uploads_data/_data)
#   FILES_HEALTHCHECK_URL  Optional separate healthchecks.io ping URL for file backup.
#                          Create a separate check at healthchecks.io for file backup
#                          monitoring independent of the DB backup check.
#   ENV_FILE             Path to .env file to source (default: /var/www/edms/.env)
#
# Behaviour by storage mode:
#   onpremise   → syncs UPLOADS_VOLUME_DIR to R2 (main use case)
#   r2 / s3     → skips with informational message (files are in cloud provider already)
#   Not found   → skips with warning (volume dir missing = new install or different path)
#
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
FILES_PREFIX="${FILES_PREFIX:-files-mirror}"
UPLOADS_VOLUME_DIR="${UPLOADS_VOLUME_DIR:-/var/lib/docker/volumes/edms_uploads_data/_data}"
FILES_HEALTHCHECK_URL="${FILES_HEALTHCHECK_URL:-}"

# ── Pre-flight checks ─────────────────────────────────────────────────────────

echo "[backup-files] ── ArcScale EDMS File Backup ── $(date)"

if [ -z "${R2_ENDPOINT:-}" ] || [ -z "${R2_ACCESS_KEY:-}" ] || [ -z "${R2_SECRET_KEY:-}" ]; then
  echo "[backup-files] FATAL: R2 credentials not configured."
  echo "[backup-files]   Required: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY"
  echo "[backup-files]   Set these in ${ENV_FILE} or export them before running."
  exit 1
fi

if ! command -v aws &> /dev/null; then
  echo "[backup-files] FATAL: aws CLI not found. Install with: apt-get install -y awscli"
  exit 1
fi

# ── Skip if uploads volume directory is not present ───────────────────────────
#
# Possible causes:
#   - Storage mode is r2 / s3 (files live in cloud, not on VPS disk)
#   - Docker is not running
#   - Volume path is customised via UPLOADS_VOLUME_DIR env var
#
# This is intentionally non-fatal (exit 0): if you run R2 file storage,
# this script should not fail your nightly cron job.

if [ ! -d "$UPLOADS_VOLUME_DIR" ]; then
  echo "[backup-files] SKIP: Uploads directory not found: ${UPLOADS_VOLUME_DIR}"
  echo "[backup-files]   Expected path for Docker-managed on-premise storage."
  echo "[backup-files]   If using R2 or S3 file storage, files are managed by the cloud provider"
  echo "[backup-files]   and do not need to be synced here."
  echo "[backup-files]   If using on-premise storage, verify Docker is running:"
  echo "[backup-files]     docker volume inspect edms_uploads_data"
  echo "[backup-files]   Override path with: UPLOADS_VOLUME_DIR=/your/path"
  exit 0
fi

# ── Count local files ─────────────────────────────────────────────────────────

FILES_BEFORE=$(find "$UPLOADS_VOLUME_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "[backup-files] Local files found: ${FILES_BEFORE} (in ${UPLOADS_VOLUME_DIR})"

if [ "$FILES_BEFORE" -eq 0 ]; then
  echo "[backup-files] SKIP: No files in uploads volume — nothing to sync."
  echo "[backup-files]   This is expected for a new installation with no uploaded documents."
  exit 0
fi

# ── Sync to R2 ────────────────────────────────────────────────────────────────
#
# Flags used:
#   --size-only   Skip re-uploading files whose size already matches in R2.
#                 Faster than checksum comparison for large binary files.
#   --no-progress Suppress per-file progress bars (unsuitable for log output).
#
# Flags intentionally NOT used:
#   --delete      Omitted per C-1 policy — files removed from VPS are retained
#                 in R2. This keeps the mirror as a safe accumulating backup.

echo "[backup-files] Syncing to R2 s3://${BACKUP_BUCKET}/${FILES_PREFIX}/ ..."
echo "[backup-files]   Mode: accumulating mirror (no deletion propagation)"

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
aws s3 sync \
  "$UPLOADS_VOLUME_DIR" \
  "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto \
  --size-only \
  --no-progress

echo "[backup-files] Sync complete."

# ── Post-sync verification ────────────────────────────────────────────────────
#
# Count objects in R2 after sync to confirm upload succeeded.
# R2 count may exceed local count: the accumulating mirror retains files
# that were previously deleted from VPS.

R2_COUNT=$(
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_KEY}" \
  aws s3 ls \
    "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --region auto \
    --recursive \
  2>/dev/null | wc -l | tr -d ' '
)

echo "[backup-files] R2 files-mirror total: ${R2_COUNT} objects (local: ${FILES_BEFORE})"

if [ "$R2_COUNT" -eq 0 ] && [ "$FILES_BEFORE" -gt 0 ]; then
  echo "[backup-files] WARN: Sync reported success but R2 shows 0 objects."
  echo "[backup-files]   Check BACKUP_BUCKET and R2 credentials."
fi

if [ "$R2_COUNT" -lt "$FILES_BEFORE" ]; then
  GAP=$((FILES_BEFORE - R2_COUNT))
  echo "[backup-files] WARN: R2 has ${GAP} fewer objects than local files."
  echo "[backup-files]   Some files may have failed to upload. Check aws s3 sync output above."
fi

# ── Healthchecks.io ping ──────────────────────────────────────────────────────

if [ -n "${FILES_HEALTHCHECK_URL}" ]; then
  if curl -fsS --retry 3 --max-time 10 "${FILES_HEALTHCHECK_URL}" > /dev/null; then
    echo "[backup-files] Dead-man ping sent: ${FILES_HEALTHCHECK_URL}"
  else
    echo "[backup-files] WARN: Failed to ping healthchecks.io — file backup monitoring may not register success."
  fi
else
  echo "[backup-files] NOTE: FILES_HEALTHCHECK_URL not set."
  echo "[backup-files]   Set it in ${ENV_FILE} to enable independent file backup alerting."
fi

echo "[backup-files] ── Done: $(date) ──"
