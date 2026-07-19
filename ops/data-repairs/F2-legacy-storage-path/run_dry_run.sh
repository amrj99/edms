#!/usr/bin/env bash
# run_dry_run.sh — ASCII-only launcher for the F2 dry-run.
#
# Why ASCII-only: pasting the Arabic (RTL) run block directly into the terminal
# corrupted the input. This launcher lives in git and is pure ASCII, so the
# operator only pastes two short lines (git pull + this) — no RTL, no big heredoc.
#
# Runs ONLY 00_dry_run.sh (read-only: no copy/verify/migrate/cleanup, no data
# change). Detects the app/DB containers, stops on ambiguity, prints final values,
# then runs the dry-run and captures output into dry_run.console.log.
#
# Usage (from anywhere):
#   nohup bash /var/www/edms/ops/data-repairs/F2-legacy-storage-path/run_dry_run.sh \
#         > /tmp/f2_dry.wrapper.log 2>&1 &
# nohup keeps it alive if the PuTTY window closes.
set -euo pipefail

PKG="$(cd "$(dirname "$0")" && pwd)"
. "$PKG/config.sh"
REPO="$(git -C "$PKG" rev-parse --show-toplevel)"
echo "repo=$REPO  package=$PKG  HEAD=$(git -C "$REPO" rev-parse --short HEAD)"

# Refuse to run a non-pristine (locally edited) package.
if [ -n "$(git -C "$REPO" status --porcelain -- "$PKG")" ]; then
  echo "STOP: local modifications in the package dir — refusing a non-pristine copy:"
  git -C "$REPO" status --porcelain -- "$PKG"
  exit 2
fi

# Optional: run the hermetic regression test first (read-only, no VPS needed).
echo "-- regression test --"
bash "$PKG/tests/preflight-dryrun.test.sh" | tail -2 || { echo "STOP: regression test failed"; exit 2; }

# ---- detect DB container (image matches postgres): exactly one ----
if [ -n "${DB_CONTAINER:-}" ]; then
  echo "DB_CONTAINER (from env): $DB_CONTAINER"
else
  DBC=""; ndb=0
  while IFS="$(printf '\t')" read -r name image; do
    case "$(printf '%s' "$image" | tr 'A-Z' 'a-z')" in *postgres*) DBC="$name"; ndb=$((ndb+1));; esac
  done < <(docker ps --format '{{.Names}}'"$(printf '\t')"'{{.Image}}')
  case "$ndb" in
    1) DB_CONTAINER="$DBC";;
    0) echo "STOP: no running postgres container. Set DB_CONTAINER=<name> and re-run."; docker ps --format '  {{.Names}} ({{.Image}})'; exit 2;;
    *) echo "STOP: multiple postgres containers - ambiguous. Set DB_CONTAINER=<name> explicitly."; docker ps --format '  {{.Names}} ({{.Image}})'; exit 2;;
  esac
fi

# ---- detect APP container (has /app/uploads), excluding DB: exactly one ----
if [ -n "${APP_CONTAINER:-}" ]; then
  echo "APP_CONTAINER (from env): $APP_CONTAINER"
else
  APPC=""; napp=0
  while IFS= read -r c; do
    [ "$c" = "$DB_CONTAINER" ] && continue
    if docker exec "$c" sh -c 'test -d /app/uploads' >/dev/null 2>&1; then APPC="$c"; napp=$((napp+1)); fi
  done < <(docker ps --format '{{.Names}}')
  case "$napp" in
    1) APP_CONTAINER="$APPC";;
    0) echo "STOP: no running container has /app/uploads. Set APP_CONTAINER=<name> and re-run."; exit 2;;
    *) echo "STOP: multiple containers have /app/uploads - ambiguous. Set APP_CONTAINER=<name> explicitly."; exit 2;;
  esac
fi

PGDB="${PGDB:-edms}"; PGUSER="${PGUSER:-edms}"
# PHYSICAL_SRC_DIR / PHYSICAL_DST_DIR / DB_*_URL_PREFIX come from config.sh.
export APP_CONTAINER DB_CONTAINER PGDB PGUSER PHYSICAL_SRC_DIR PHYSICAL_DST_DIR DB_OLD_URL_PREFIX DB_NEW_URL_PREFIX SRC_DIR DST_DIR

# DB connectivity is required (inventory is meaningless without it).
docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -tAc 'SELECT 1' >/dev/null 2>&1 \
  || { echo "STOP: cannot connect psql -U $PGUSER -d $PGDB inside $DB_CONTAINER. Fix PGUSER/PGDB."; exit 2; }

# Physical-source precheck is diagnostic only (non-blocking).
if docker exec "$APP_CONTAINER" test -d "$PHYSICAL_SRC_DIR"; then
  echo "SRC_DIR_PRECHECK: exists ($PHYSICAL_SRC_DIR)"
else
  echo "SRC_DIR_PRECHECK: MISSING ($PHYSICAL_SRC_DIR) - dry-run will record and continue"
fi

echo "======== FINAL VALUES (dry-run only) ========"
echo "  APP_CONTAINER    = $APP_CONTAINER"
echo "  DB_CONTAINER     = $DB_CONTAINER"
echo "  PGDB             = $PGDB"
echo "  PGUSER           = $PGUSER"
echo "  DB_OLD_URL_PREFIX= $DB_OLD_URL_PREFIX"
echo "  DB_NEW_URL_PREFIX= $DB_NEW_URL_PREFIX"
echo "  PHYSICAL_SRC_DIR = $PHYSICAL_SRC_DIR"
echo "  PHYSICAL_DST_DIR = $PHYSICAL_DST_DIR"
echo "============================================="

cd "$PKG"
bash 00_dry_run.sh > dry_run.console.log 2>&1 && rc=0 || rc=$?
echo "FINAL_EXIT=$rc"
echo "outputs in: $PKG  (dry_run.console.log, dry_run_report.txt, mapping.gen.tsv, mapping.mig.tsv, preimage.tsv)"
