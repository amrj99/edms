#!/usr/bin/env bash
# compile-check-real.sh — real-PostgreSQL COMPILE proof for the ACTUAL
# 04_migrate.sql and 05_rollback.sql (NO replica — runs the real files).
#
# It spins a THROWAWAY postgres container (never the edms container / edms DB),
# feeds an EMPTY map, and runs each real .sql file through psql:
#   • A malformed RAISE fails at COMPILE time
#       → "too many/few parameters specified for RAISE"        => COMPILE FAIL
#   • A healthy file compiles, then hits its own well-formed guard
#       → "map has 0 rows (expected 7)"                        => COMPILE OK
#   (The real UPDATE never runs: EXECUTE is opaque and the empty map means the
#    loop body is never entered, so the production tables are not even required.)
#
# SAFETY: dedicated temp container (postgres:16-alpine), a scratch DB named
# "scratch" (NOT edms), auto-removed via --rm + trap. Production is never touched.
# No hard-coded production credentials (throwaway password for the temp container).
#
# Requires docker on the host. Exit 0 iff BOTH real files compile.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(dirname "$HERE")"
IMG="${PG_IMAGE:-postgres:16-alpine}"
TMPPG="f2_compilecheck_$$"          # unique per run; $$ = shell PID
EMPTY="/tmp/f2_empty_map.$$.tsv"

cleanup(){ docker rm -f "$TMPPG" >/dev/null 2>&1 || true; rm -f "$EMPTY" 2>/dev/null || true; }
trap cleanup EXIT

echo "temp_container=$TMPPG  image=$IMG  (throwaway; NOT edms_postgres, NOT edms DB)"

docker run -d --rm --name "$TMPPG" -e POSTGRES_PASSWORD=scratch "$IMG" >/dev/null \
  || { echo "FATAL: cannot start temp container"; exit 2; }

# wait for readiness
ready=0
for _ in $(seq 1 30); do
  if docker exec "$TMPPG" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo "FATAL: temp postgres not ready"; exit 2; }

docker exec "$TMPPG" psql -U postgres -c "CREATE DATABASE scratch;" >/dev/null \
  || { echo "FATAL: cannot create scratch DB"; exit 2; }

# empty map → real DO blocks compile, then raise 'map has 0 rows (expected 7)'
: > "$EMPTY"
docker cp "$EMPTY" "$TMPPG":/tmp/mapping.mig.tsv >/dev/null

overall=0
for f in 04_migrate.sql 05_rollback.sql; do
  echo ""
  echo "== compile REAL: $f =="
  out="$(docker exec -i -w /tmp "$TMPPG" psql -U postgres -d scratch -f - < "$PKG/$f" 2>&1)"
  echo "$out"
  if printf '%s' "$out" | grep -qE "too (many|few) parameters specified for RAISE"; then
    echo "RESULT[$f]: COMPILE FAIL (malformed RAISE)"; overall=1
  elif printf '%s' "$out" | grep -qF "map has 0 rows (expected 7)"; then
    echo "RESULT[$f]: COMPILE OK (reached runtime guard on empty map)"
  else
    echo "RESULT[$f]: UNEXPECTED — review output above"; overall=1
  fi
done

echo ""
if [ "$overall" -eq 0 ]; then echo "COMPILE-CHECK-REAL: BOTH REAL FILES COMPILE"; else echo "COMPILE-CHECK-REAL: FAILURE"; fi
exit "$overall"
