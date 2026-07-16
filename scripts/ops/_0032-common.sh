#!/usr/bin/env bash
# _0032-common.sh — shared discovery & helpers for the 0032 Owner-Run gate.
# Sourced by 0032-gate-readonly.sh / 0032-backup-verify.sh / 0032-rollback.sh.
# NEVER prints secrets. NEVER guesses env — it verifies and STOPS on mismatch.
set -Eeuo pipefail

# ── Configurable (env overrides; verified before use, never assumed) ──────────
DB_CONTAINER="${DB_CONTAINER:-edms_postgres}"
DB_USER="${DB_USER:-edms}"
DB_NAME="${DB_NAME:-edms}"

log()  { printf '[0032] %s\n' "$*" >&2; }
die()  { printf '[0032] STOP: %s\n' "$*" >&2; exit 1; }

# ── Discovery: verify the container + DB actually exist; do NOT guess ─────────
discover() {
  command -v docker >/dev/null 2>&1 || die "docker not found on this host."

  if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    log "Container '$DB_CONTAINER' is not running. Candidate postgres containers:"
    docker ps --format '{{.Names}}\t{{.Image}}' | grep -iE 'postgres|edms' >&2 || log "  (none found)"
    die "Set the correct container explicitly, e.g.:  DB_CONTAINER=<name> $0"
  fi

  # Verify DB connectivity + names WITHOUT modifying anything (SELECT 1).
  if ! docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; then
    die "Cannot connect as user '$DB_USER' to db '$DB_NAME' in '$DB_CONTAINER'. Set DB_USER/DB_NAME explicitly; not guessing."
  fi

  DB_IDENTITY="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT current_database()||'|'||(SELECT system_identifier FROM pg_control_system())")"
  DB_REAL_NAME="${DB_IDENTITY%%|*}"
  DB_SYSID="${DB_IDENTITY##*|}"
  log "Verified: container='$DB_CONTAINER' db='$DB_REAL_NAME' system_identifier='$DB_SYSID'"
}

# Run a read-only query, tab-separated, no alignment. (Callers pass SELECT/EXPLAIN only.)
pg_ro() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
pg_tbl(){ docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "$1"; }

new_results_dir() {
  local base="${RESULTS_BASE:-$HOME/0032-gate}"
  RESULTS_DIR="$base/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RESULTS_DIR"; chmod 700 "$RESULTS_DIR"
  log "Results dir: $RESULTS_DIR"
}

sha_dir() { ( cd "$1" && for f in *; do [ -f "$f" ] && sha256sum "$f"; done ) 2>/dev/null || true; }
