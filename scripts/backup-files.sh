#!/bin/bash
# =============================================================================
# backup-files.sh — ArcScale EDMS on-premise file backup to Cloudflare R2
#                   HARDENED (R1): dated, age-ENCRYPTED tarball, isolated token
# =============================================================================
#
# Backs up the on-premise uploads_data Docker volume as a single dated,
# age-encrypted tarball. Cloud-backed files (storage_type r2/s3) are NOT copied
# — they already live in the provider and are protected in place (versioning/
# bucket-lock/lifecycle per the Backup & DR architecture). This never full-copies
# customer object storage; it only snapshots the small on-premise residual.
#
# ── Change from the previous version ──────────────────────────────────────────
#   OLD: `aws s3 sync` of individual RAW files → edms-backups/files-mirror/
#   NEW: tar → age-encrypt → ONE dated object → edms-backups/files-mirror-enc/
#        + retention. The old files-mirror/ objects are left untouched.
#   Why: encryption (raw files no longer sit in R2), atomicity, and consistency
#        with the DB backup. The on-premise set is tiny, so a full dated tarball
#        is cheap; per-file mirroring is unnecessary here.
#
# Called by backup.sh after the DB dump; may also run standalone.
#
# Env (from /var/www/edms/.env or exported):
#   R2_ENDPOINT (required)
#   BACKUP_R2_ACCESS_KEY/SECRET  (scoped token; falls back to R2_ACCESS_KEY/SECRET)
#   BACKUP_BUCKET        default: edms-backups
#   FILES_PREFIX         default: files-mirror-enc
#   FILES_RETAIN_DAYS    default: 90
#   AGE_RECIPIENTS       default: /etc/edms-age-recipients.txt  (REQUIRED to run)
#   UPLOADS_VOLUME_DIR   default: /var/lib/docker/volumes/edms_uploads_data/_data
#   FILES_HEALTHCHECK_URL  optional independent dead-man ping
#   ENV_FILE             default: /var/www/edms/.env
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then set -a; source "$ENV_FILE"; set +a; fi

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
FILES_PREFIX="${FILES_PREFIX:-files-mirror-enc}"
FILES_RETAIN_DAYS="${FILES_RETAIN_DAYS:-90}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-/etc/edms-age-recipients.txt}"
UPLOADS_VOLUME_DIR="${UPLOADS_VOLUME_DIR:-/var/lib/docker/volumes/edms_uploads_data/_data}"
FILES_HEALTHCHECK_URL="${FILES_HEALTHCHECK_URL:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
WORK="/tmp/edms-backups"

# FAIL-CLOSED: scoped backup token required; no fallback to prod R2_*.
BK_KEY="${BACKUP_R2_ACCESS_KEY:-}"
BK_SECRET="${BACKUP_R2_SECRET_KEY:-}"

echo "[backup-files] ── ArcScale EDMS File Backup (encrypted tarball) ── $(date)"

if [ -z "${R2_ENDPOINT:-}" ] || [ -z "$BK_KEY" ] || [ -z "$BK_SECRET" ]; then
  echo "[backup-files] FATAL: scoped backup creds required — set BACKUP_R2_ACCESS_KEY + BACKUP_R2_SECRET_KEY (+ R2_ENDPOINT). No fallback to prod R2_*."; exit 1
fi
command -v aws >/dev/null 2>&1 || { echo "[backup-files] FATAL: aws CLI not found."; exit 1; }

AGE_BIN="$(command -v age || true)"
if [ ! -r "$AGE_RECIPIENTS" ] || ! grep -q '^age1' "$AGE_RECIPIENTS"; then
  echo "[backup-files] FATAL: AGE_RECIPIENTS ($AGE_RECIPIENTS) missing/empty — encryption is mandatory for file backups (R1-H2). Skipping upload."
  exit 1
fi
[ -x "$AGE_BIN" ] || { echo "[backup-files] FATAL: 'age' not installed."; exit 1; }

# Skip cleanly if there is no on-premise volume (e.g. all storage is r2/s3).
if [ ! -d "$UPLOADS_VOLUME_DIR" ]; then
  echo "[backup-files] SKIP: uploads dir not found ($UPLOADS_VOLUME_DIR) — cloud storage or new install."; exit 0
fi
NFILES=$(find "$UPLOADS_VOLUME_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$NFILES" -eq 0 ]; then echo "[backup-files] SKIP: no files in uploads volume."; exit 0; fi
echo "[backup-files] Local files: ${NFILES}"

awsbk(){ AWS_ACCESS_KEY_ID="$BK_KEY" AWS_SECRET_ACCESS_KEY="$BK_SECRET" aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto; }
age_encrypt(){ local args=(); while read -r r; do [ -n "$r" ] && args+=(-r "$r"); done < <(grep '^age1' "$AGE_RECIPIENTS"); "$AGE_BIN" "${args[@]}" -o "$2" "$1"; }

mkdir -p "$WORK"; chmod 700 "$WORK"
TAR="${WORK}/edms_uploads_${TIMESTAMP}.tar"
tar -cf "$TAR" -C "$UPLOADS_VOLUME_DIR" . || { echo "[backup-files] FATAL: tar failed."; exit 1; }
sha256sum "$TAR" | awk '{print $1}' > "${TAR}.sha256"
age_encrypt "$TAR" "${TAR}.age" || { echo "[backup-files] FATAL: age encryption failed."; exit 1; }
head -c 30 "${TAR}.age" | grep -q "age-encryption.org" || { echo "[backup-files] FATAL: encrypted tar missing age header."; exit 1; }
rm -f "$TAR"
echo "[backup-files] Encrypted tar: $(du -h "${TAR}.age" | cut -f1) (${NFILES} files)"

awsbk s3 cp "${TAR}.age"    "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/edms_uploads_${TIMESTAMP}.tar.age"    --no-progress
awsbk s3 cp "${TAR}.sha256" "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/edms_uploads_${TIMESTAMP}.tar.sha256" --no-progress
rm -f "${TAR}.age" "${TAR}.sha256"
echo "[backup-files] Uploaded to s3://${BACKUP_BUCKET}/${FILES_PREFIX}/"

# ── Retention (matches dated tarballs only; old files-mirror/ untouched) ──────
if date -d "1 day ago" >/dev/null 2>&1; then CUTOFF=$(date -d "${FILES_RETAIN_DAYS} days ago" +%Y%m%d); else CUTOFF=$(date -v-${FILES_RETAIN_DAYS}d +%Y%m%d); fi
PRUNED=0
while IFS= read -r f; do
  fdate=$(echo "$f" | grep -oE '[0-9]{8}' | head -1 || true)
  if [ -n "$fdate" ] && [ "$fdate" -lt "$CUTOFF" ] 2>/dev/null; then
    awsbk s3 rm "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/${f}" >/dev/null && { echo "[backup-files] Pruned: ${f}"; PRUNED=$((PRUNED+1)); }
  fi
done < <(awsbk s3 ls "s3://${BACKUP_BUCKET}/${FILES_PREFIX}/" | awk '{print $4}' | grep -E '^edms_uploads_[0-9]' || true)
echo "[backup-files] Pruned ${PRUNED} old file tarball(s)."

if [ -n "${FILES_HEALTHCHECK_URL}" ]; then
  curl -fsS --retry 3 --max-time 10 "${FILES_HEALTHCHECK_URL}" >/dev/null && echo "[backup-files] Dead-man ping sent." || echo "[backup-files] WARN: files ping failed."
else
  echo "[backup-files] NOTE: FILES_HEALTHCHECK_URL not set (R1-H5)."
fi
echo "[backup-files] ── Done: $(date) ──"
