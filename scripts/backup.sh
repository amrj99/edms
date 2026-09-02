#!/bin/bash
# =============================================================================
# backup.sh — ArcScale EDMS nightly PostgreSQL backup to Cloudflare R2
#             HARDENED (R1): age-encrypted, isolated backup token, .env snapshot
# =============================================================================
#
# Usage:
#   bash /var/www/edms/scripts/backup.sh
#
# Cron (root, 02:00 nightly):
#   0 2 * * * /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1
#
# Prerequisites on the VPS:
#   apt-get install -y awscli
#   age (https://github.com/FiloSottile/age) — REQUIRED once AGE_RECIPIENTS is set
#   docker running edms_postgres
#
# ── R1 hardening (2026-09) ────────────────────────────────────────────────────
#   1. ENCRYPTION: the dump is age-encrypted to the PUBLIC recipients in
#      AGE_RECIPIENTS before it ever leaves the host. Only the off-host PRIVATE
#      identities can decrypt (see restore-verify.sh). No plaintext dump is
#      uploaded once AGE_RECIPIENTS is configured.
#   2. ISOLATED CREDENTIALS: uploads use BACKUP_R2_ACCESS_KEY/SECRET (a token
#      scoped to the backup bucket ONLY), NOT the production all-buckets token.
#      Falls back to R2_ACCESS_KEY/SECRET if the scoped vars are unset (so the
#      job keeps working during rollout), but the scoped token is the goal.
#   3. .env SNAPSHOT: an encrypted copy of the config is uploaded so a fresh VPS
#      can be reconstituted. Uploaded ONLY when encryption is active.
#
# Required environment variables (set in /var/www/edms/.env or exported):
#   R2_ENDPOINT       Cloudflare R2 endpoint (https://<account>.r2.cloudflarestorage.com)
#
# Backup credentials (prefer the scoped token; falls back to prod creds):
#   BACKUP_R2_ACCESS_KEY / BACKUP_R2_SECRET_KEY   scoped-to-edms-backups token
#   R2_ACCESS_KEY / R2_SECRET_KEY                 fallback (prod all-buckets)
#
# Optional environment variables:
#   BACKUP_BUCKET       default: edms-backups          (SEPARATE from file storage)
#   BACKUP_PREFIX       default: nightly
#   BACKUP_RETAIN_DAYS  default: 90
#   AGE_RECIPIENTS      default: /etc/edms-age-recipients.txt (>=1 age1 line → encrypt)
#   ENV_PREFIX          default: config                (encrypted .env snapshots)
#   HEALTHCHECK_URL     healthchecks.io ping URL (dead-man)
#   DB_CONTAINER/DB_USER/DB_NAME   default: edms_postgres / edms / edms
#   ENV_FILE            default: /var/www/edms/.env
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then set -a; source "$ENV_FILE"; set +a; fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/edms-backups"
FILENAME="edms_${TIMESTAMP}.dump"
TEMP_FILE="${BACKUP_DIR}/${FILENAME}"

BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-nightly}"
ENV_PREFIX="${ENV_PREFIX:-config}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-90}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
DB_CONTAINER="${DB_CONTAINER:-edms_postgres}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-/etc/edms-age-recipients.txt}"

# Isolated backup credentials — FAIL-CLOSED: the scoped backup token is required.
# No fallback to the production R2_* token (a silent fallback would defeat the
# credential isolation and could hide a missing/rotated backup token).
BK_KEY="${BACKUP_R2_ACCESS_KEY:-}"
BK_SECRET="${BACKUP_R2_SECRET_KEY:-}"

echo "[backup] ── ArcScale EDMS Backup (hardened) ── $(date)"

# ── Pre-flight ────────────────────────────────────────────────────────────────
if [ -z "${R2_ENDPOINT:-}" ] || [ -z "$BK_KEY" ] || [ -z "$BK_SECRET" ]; then
  echo "[backup] FATAL: scoped backup creds required — set BACKUP_R2_ACCESS_KEY + BACKUP_R2_SECRET_KEY (+ R2_ENDPOINT). No fallback to prod R2_*."; exit 1
fi
command -v aws >/dev/null 2>&1 || { echo "[backup] FATAL: aws CLI not found."; exit 1; }

# Encryption is ACTIVE when a recipients file with >=1 age1 line exists.
ENCRYPT=0; AGE_BIN="$(command -v age || true)"
if [ -r "$AGE_RECIPIENTS" ] && grep -q '^age1' "$AGE_RECIPIENTS"; then
  [ -x "$AGE_BIN" ] || { echo "[backup] FATAL: AGE_RECIPIENTS set but 'age' not installed."; exit 1; }
  RCOUNT=$(grep -c '^age1' "$AGE_RECIPIENTS")
  [ "$RCOUNT" -ge 2 ] || echo "[backup] WARN: only $RCOUNT age recipient(s) — 2 recommended (primary + break-glass)."
  ENCRYPT=1
  echo "[backup] Encryption: ON (${RCOUNT} recipient(s))"
else
  echo "[backup] WARN: encryption OFF (no AGE_RECIPIENTS). Uploading RAW dump — configure ${AGE_RECIPIENTS} to enable (R1-H2)."
fi

docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$" || { echo "[backup] FATAL: container '${DB_CONTAINER}' not running."; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────
awsbk(){ AWS_ACCESS_KEY_ID="$BK_KEY" AWS_SECRET_ACCESS_KEY="$BK_SECRET" aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto; }
age_encrypt(){ # $1=in $2=out — encrypt to all age1 recipients
  local args=(); while read -r r; do [ -n "$r" ] && args+=(-r "$r"); done < <(grep '^age1' "$AGE_RECIPIENTS")
  "$AGE_BIN" "${args[@]}" -o "$2" "$1"
}

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"

# ── Dump ──────────────────────────────────────────────────────────────────────
echo "[backup] Dumping '${DB_NAME}' from '${DB_CONTAINER}'..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" --format=custom --compress=9 --no-password "$DB_NAME" > "$TEMP_FILE"
echo "[backup] Dump complete: ${FILENAME} ($(du -h "$TEMP_FILE" | cut -f1))"

# ── Encrypt (if active) ───────────────────────────────────────────────────────
UPLOAD_FILE="$TEMP_FILE"; UPLOAD_NAME="$FILENAME"
if [ "$ENCRYPT" = "1" ]; then
  age_encrypt "$TEMP_FILE" "${TEMP_FILE}.age" || { echo "[backup] FATAL: age encryption failed."; exit 1; }
  head -c 30 "${TEMP_FILE}.age" | grep -q "age-encryption.org" || { echo "[backup] FATAL: encrypted output missing age header."; exit 1; }
  rm -f "$TEMP_FILE"                                  # never keep/upload the plaintext dump
  UPLOAD_FILE="${TEMP_FILE}.age"; UPLOAD_NAME="${FILENAME}.age"
  echo "[backup] Encrypted: ${UPLOAD_NAME} ($(du -h "$UPLOAD_FILE" | cut -f1))"
fi

# ── Upload (isolated token) ───────────────────────────────────────────────────
echo "[backup] Uploading to s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${UPLOAD_NAME} ..."
awsbk s3 cp "$UPLOAD_FILE" "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${UPLOAD_NAME}" --no-progress
echo "[backup] Upload complete."
rm -f "$UPLOAD_FILE"

# ── .env snapshot (encrypted only) ────────────────────────────────────────────
if [ "$ENCRYPT" = "1" ] && [ -r "$ENV_FILE" ]; then
  SNAP="${BACKUP_DIR}/edms_env_${TIMESTAMP}.snap"
  cp "$ENV_FILE" "$SNAP"; age_encrypt "$SNAP" "${SNAP}.age"; rm -f "$SNAP"
  awsbk s3 cp "${SNAP}.age" "s3://${BACKUP_BUCKET}/${ENV_PREFIX}/edms_env_${TIMESTAMP}.snap.age" --no-progress
  rm -f "${SNAP}.age"
  echo "[backup] .env snapshot uploaded (encrypted) to ${ENV_PREFIX}/."
fi

# ── Prune old DB backups (matches .dump and .dump.age) ────────────────────────
echo "[backup] Pruning DB backups older than ${BACKUP_RETAIN_DAYS} days..."
if date -d "1 day ago" >/dev/null 2>&1; then CUTOFF=$(date -d "${BACKUP_RETAIN_DAYS} days ago" +%Y%m%d); else CUTOFF=$(date -v-${BACKUP_RETAIN_DAYS}d +%Y%m%d); fi
PRUNED=0
while IFS= read -r f; do
  fdate=$(echo "$f" | grep -oE '[0-9]{8}' | head -1 || true)
  if [ -n "$fdate" ] && [ "$fdate" -lt "$CUTOFF" ] 2>/dev/null; then
    awsbk s3 rm "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${f}" >/dev/null && { echo "[backup] Pruned: ${f}"; PRUNED=$((PRUNED+1)); }
  fi
done < <(awsbk s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" | awk '{print $4}' | grep -E '^edms_[0-9]' || true)
echo "[backup] Pruned ${PRUNED} old DB backup(s)."

# ── Dead-man ping ─────────────────────────────────────────────────────────────
if [ -n "${HEALTHCHECK_URL}" ]; then
  curl -fsS --retry 3 --max-time 10 "${HEALTHCHECK_URL}" >/dev/null && echo "[backup] Dead-man ping sent." || echo "[backup] WARN: healthchecks ping failed."
else
  echo "[backup] WARN: HEALTHCHECK_URL not set."
fi

# ── File backup (encrypted tarball) — non-fatal ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if bash "${SCRIPT_DIR}/backup-files.sh"; then echo "[backup] File backup complete."; else echo "[backup] WARN: file backup failed (DB backup already safe in R2)."; fi

echo "[backup] ── Done: $(date) ──"
