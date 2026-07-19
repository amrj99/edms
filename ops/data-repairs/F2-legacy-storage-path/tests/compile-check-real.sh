#!/usr/bin/env bash
# compile-check-real.sh — real-PostgreSQL COMPILE proof for the ACTUAL
# 04_migrate.sql and 05_rollback.sql (NO replica — runs the real files verbatim).
#
# Method: spin a THROWAWAY postgres container (never edms_postgres / edms DB),
# feed an EMPTY map, and run each real .sql file through psql in its OWN psql
# session. With an empty map the real DO block compiles, then hits its own
# well-formed guard `map has 0 rows (expected 7)` BEFORE the loop (so the opaque
# EXECUTE UPDATE never runs and the production tables are not even required).
#
# A file is COMPILE-OK only if ALL hold (no error is treated as success by luck):
#   • its output contains EXACTLY ONE  'map has 0 rows (expected 7)'  (the guard),
#   • AND contains NONE of: too many/few parameters specified for RAISE,
#     'syntax error', 'does not exist', 'No such file', 'could not open file'.
# Otherwise → COMPILE FAIL.
#
# SAFETY: dedicated temp container + scratch DB (NOT edms); auto-removed via --rm
# and a trap on INT/TERM/EXIT (cleans on Ctrl+C or any failure). No production
# credentials (throwaway password). Reads the real files read-only; never sed's
# them in place; writes only to a private /tmp file. Requires docker on the host.
# Exit 0 iff BOTH real files compile.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(dirname "$HERE")"
IMG="${PG_IMAGE:-postgres:16-alpine}"
TMPPG="f2_compilecheck_$$"                 # unique; $$ = shell PID
EMPTY="/tmp/f2_empty_map.$$.tsv"

cleanup(){ docker rm -f "$TMPPG" >/dev/null 2>&1 || true; rm -f "$EMPTY" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

echo "temp_container=$TMPPG  image=$IMG  scratch_db=scratch  (throwaway; NOT edms_postgres, NOT edms DB)"

docker run -d --rm --name "$TMPPG" -e POSTGRES_PASSWORD=scratch "$IMG" >/dev/null \
  || { echo "FATAL: cannot start temp container"; exit 2; }

ready=0
for _ in $(seq 1 30); do
  if docker exec "$TMPPG" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo "FATAL: temp postgres not ready"; exit 2; }

docker exec "$TMPPG" psql -U postgres -c "CREATE DATABASE scratch;" >/dev/null \
  || { echo "FATAL: cannot create scratch DB"; exit 2; }

: > "$EMPTY"                                # empty map (0 rows)
docker cp "$EMPTY" "$TMPPG":/tmp/mapping.mig.tsv >/dev/null \
  || { echo "FATAL: cannot stage empty map into temp container"; exit 2; }

BAD_RE='too many parameters specified for RAISE|too few parameters specified for RAISE|syntax error|does not exist|No such file|could not open file'
GUARD='map has 0 rows (expected 7)'

overall=0
for f in 04_migrate.sql 05_rollback.sql; do
  echo ""
  echo "== compile REAL: $f  (own psql session) =="
  # each run = a fresh psql session/process (temp tables auto-dropped at session end)
  out="$(docker exec -i -w /tmp "$TMPPG" psql -U postgres -d scratch -f - < "$PKG/$f" 2>&1)"
  psql_rc=$?
  echo "$out"
  echo "PSQL_EXIT[$f]=$psql_rc"

  bad="$(printf '%s\n' "$out" | grep -Ec "$BAD_RE")"
  guard="$(printf '%s\n' "$out" | grep -Fc "$GUARD")"
  echo "diagnostics[$f]: bad_patterns=$bad  guard_hits=$guard"

  if [ "$bad" -ne 0 ]; then
    echo "RESULT[$f]: COMPILE FAIL — forbidden error present (RAISE/syntax/relation/file)"; overall=1
  elif [ "$guard" -eq 1 ]; then
    echo "RESULT[$f]: COMPILE OK — compiled, reached its own guard exactly once"
  else
    echo "RESULT[$f]: UNEXPECTED — guard_hits=$guard (expected exactly 1); review output"; overall=1
  fi
done

echo ""
if [ "$overall" -eq 0 ]; then echo "COMPILE-CHECK-REAL: BOTH REAL FILES COMPILE"; else echo "COMPILE-CHECK-REAL: FAILURE"; fi
exit "$overall"
