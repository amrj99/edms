#!/bin/bash
# =============================================================================
# restore-verify.sh — ArcScale EDMS recoverability drill (R1, OFF-VPS)
# =============================================================================
#
# Proves an ENCRYPTED backup is RESTORABLE — not merely present. Run this OFF the
# production VPS, on a host that holds a PRIVATE age identity (primary or
# break-glass). The production VPS never holds a private key (R1 security rule).
#
#   find latest encrypted DB backup in R2 (scoped token, read)
#     → age-decrypt with a PRIVATE identity
#     → pg_restore into a THROWAWAY scratch container (never production)
#     → SELF-INTEGRITY checks (the authoritative PASS/FAIL)
#     → optional compare to a read-only count snapshot (extra, non-gating)
#     → teardown scratch  → optional recoverability ping
#
# PASS criterion (per architecture decision D2-a): the backup's OWN integrity —
# decrypt OK, restore into a clean PostgreSQL, schema + critical tables present
# and non-empty, relational/integrity checks pass. Live-count comparison is an
# OPTIONAL extra only (production data changes between backup and drill).
#
# Requirements on THIS (off-VPS) host: age, aws, docker.
#
# Env:
#   R2_ENDPOINT (required)
#   BACKUP_R2_ACCESS_KEY/SECRET  scoped backup token (read); falls back to R2_*
#   AGE_IDENTITY   (required) path to a PRIVATE age identity file (mode 600)
#   BACKUP_BUCKET  default: edms-backups
#   BACKUP_PREFIX  default: nightly
#   TEST_PORT      default: 5459
#   PG_IMAGE       default: postgres:16-alpine
#   DB_USER/DB_NAME default: edms / edms
#   COUNT_SNAPSHOT (optional) file of "table<TAB>count" lines for extra compare
#   HC_RECOVER_URL (optional) healthchecks ping URL for recoverability health
# =============================================================================

set -euo pipefail

: "${AGE_IDENTITY:?set AGE_IDENTITY to a PRIVATE age key path (this host, off-VPS)}"
R2_ENDPOINT="${R2_ENDPOINT:?set R2_ENDPOINT}"
BK_KEY="${BACKUP_R2_ACCESS_KEY:-${R2_ACCESS_KEY:-}}"
BK_SECRET="${BACKUP_R2_SECRET_KEY:-${R2_SECRET_KEY:-}}"
[ -n "$BK_KEY" ] && [ -n "$BK_SECRET" ] || { echo "[drill] FATAL: backup R2 credentials not set."; exit 1; }
BACKUP_BUCKET="${BACKUP_BUCKET:-edms-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-nightly}"
TEST_PORT="${TEST_PORT:-5459}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
DB_USER="${DB_USER:-edms}"; DB_NAME="${DB_NAME:-edms}"
COUNT_SNAPSHOT="${COUNT_SNAPSHOT:-}"
HC_RECOVER_URL="${HC_RECOVER_URL:-}"
SCRATCH="edms_restore_scratch_$$"
WORK="$(mktemp -d)"; TESTPW="restore_only_$$"

command -v age >/dev/null 2>&1 || { echo "[drill] FATAL: age not installed on this host."; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "[drill] FATAL: aws not installed."; exit 1; }
[ -r "$AGE_IDENTITY" ] || { echo "[drill] FATAL: AGE_IDENTITY not readable: $AGE_IDENTITY"; exit 1; }

cleanup(){ docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
awsbk(){ AWS_ACCESS_KEY_ID="$BK_KEY" AWS_SECRET_ACCESS_KEY="$BK_SECRET" aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto; }
q(){ docker exec -e PGPASSWORD="$TESTPW" "$SCRATCH" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d ' '; }

echo "[drill] ── Recoverability Drill (off-VPS) ── $(date -u)"

# ── 1. Latest encrypted DB backup ─────────────────────────────────────────────
LATEST=$(awsbk s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" | awk '{print $4}' | grep -E '^edms_[0-9].*\.dump\.age$' | sort | tail -1)
[ -n "$LATEST" ] || { echo "[drill] FATAL: no encrypted (.dump.age) backups found in ${BACKUP_PREFIX}/."; exit 1; }
echo "[drill] latest: $LATEST"
awsbk s3 cp "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${LATEST}" "${WORK}/d.age" --no-progress

# ── 2. Decrypt with a PRIVATE identity ────────────────────────────────────────
age -d -i "$AGE_IDENTITY" -o "${WORK}/d.dump" "${WORK}/d.age" || { echo "[drill] FATAL: decrypt failed (wrong key or corrupt)."; exit 1; }
echo "[drill] decrypt OK ($(du -h "${WORK}/d.dump" | cut -f1))"

# ── 3. Throwaway scratch container ────────────────────────────────────────────
docker run -d --name "$SCRATCH" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$TESTPW" -e POSTGRES_DB="$DB_NAME" -p "${TEST_PORT}:5432" "$PG_IMAGE" >/dev/null
W=0; until docker exec -e PGPASSWORD="$TESTPW" "$SCRATCH" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; do sleep 1; W=$((W+1)); [ "$W" -gt 60 ] && { echo "[drill] FATAL: scratch not ready."; exit 1; }; done

# Pre-create membership-RLS roles so the dump's GRANTs apply cleanly (idempotent).
docker exec -e PGPASSWORD="$TESTPW" "$SCRATCH" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -q \
  -c 'DO $$ BEGIN CREATE ROLE edms_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;' \
  -c 'DO $$ BEGIN CREATE ROLE edms_rls_owner; EXCEPTION WHEN duplicate_object THEN NULL; END $$;' >/dev/null 2>&1 || true

# ── 4. Restore (exit code non-authoritative; checks below decide) ──────────────
docker exec -i -e PGPASSWORD="$TESTPW" "$SCRATCH" pg_restore -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" --no-password --no-owner < "${WORK}/d.dump" 2>"${WORK}/restore.err" || true
RESTORE_ERRS=$(grep -c 'error:' "${WORK}/restore.err" 2>/dev/null || echo 0)
echo "[drill] pg_restore done (residual errors: ${RESTORE_ERRS})"

# ── 5. SELF-INTEGRITY (authoritative) ─────────────────────────────────────────
PASS=true; CRIT="organizations users projects documents"
for t in $CRIT audit_logs subscriptions; do
  exists=$(q "SELECT to_regclass('public.$t') IS NOT NULL;")
  cnt=$(q "SELECT count(*) FROM $t;")
  echo "[drill]   $t: exists=${exists:-f} count=${cnt:-NA}"
  [ "$exists" = "t" ] || { echo "[drill]   MISSING critical table: $t"; case " $CRIT audit_logs " in *" $t "*) PASS=false;; esac; }
done
# critical non-emptiness (a real deployment must have orgs + users)
for t in organizations users; do
  c=$(q "SELECT count(*) FROM $t;"); [ "${c:-0}" -gt 0 ] 2>/dev/null || { echo "[drill]   FAIL: $t is EMPTY"; PASS=false; }
done
# relational sanity
ORPH_U=$(q "SELECT count(*) FROM users u LEFT JOIN organizations o ON u.organization_id=o.id WHERE u.organization_id IS NOT NULL AND o.id IS NULL;")
echo "[drill]   users with dangling org: ${ORPH_U:-?} (expect 0)"
[ "${ORPH_U:-1}" = "0" ] || PASS=false
if [ "$(q "SELECT to_regclass('public.documents') IS NOT NULL;")" = "t" ] && [ "$(q "SELECT to_regclass('public.projects') IS NOT NULL;")" = "t" ]; then
  ORPH_D=$(q "SELECT count(*) FROM documents d LEFT JOIN projects p ON d.project_id=p.id WHERE d.project_id IS NOT NULL AND p.id IS NULL;")
  echo "[drill]   documents with dangling project: ${ORPH_D:-?} (expect 0)"
  [ "${ORPH_D:-1}" = "0" ] || PASS=false
fi

# ── 6. Optional: compare to a read-only count snapshot (non-gating) ───────────
if [ -n "$COUNT_SNAPSHOT" ] && [ -r "$COUNT_SNAPSHOT" ]; then
  echo "[drill] optional snapshot compare:"
  while IFS=$'\t' read -r t expected; do
    [ -n "$t" ] || continue; got=$(q "SELECT count(*) FROM $t;")
    echo "[drill]   $t: snapshot=${expected} restored=${got:-NA} (informational; restored<=snapshot is normal)"
  done < "$COUNT_SNAPSHOT"
fi

echo ""
if [ "$PASS" = "true" ]; then
  echo "[drill] ✓ PASS — backup ${LATEST} decrypts and restores to a consistent DB."
  [ -n "$HC_RECOVER_URL" ] && curl -fsS -m 15 --data-binary "restore ok ${LATEST}" "$HC_RECOVER_URL" >/dev/null 2>&1 && echo "[drill] recoverability ping sent" || true
else
  echo "[drill] ✗ FAIL — investigate before relying on this backup."; exit 1
fi
echo "[drill] ── Done: $(date -u) ──"
