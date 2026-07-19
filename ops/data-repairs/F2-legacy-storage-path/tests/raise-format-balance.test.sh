#!/usr/bin/env bash
# raise-format-balance.test.sh — permanent narrow regression guard.
#
# Catches the class of bug that broke 04_migrate.sql on production: a plpgsql
# `RAISE ... , args;` whose format string has a different number of `%`
# placeholders than the number of arguments supplied → PostgreSQL fails at
# COMPILE time ("too many/few parameters specified for RAISE"), which aborts the
# whole DO block before any statement runs.
#
# Rule checked, per RAISE statement in the migrate/rollback SQL:
#   placeholders == argument_count
# where placeholders = count of `%` after removing every literal `%%`.
#
# Hermetic: pure awk/bash, NO database needed. (A real-PostgreSQL compile proof
# of the ACTUAL files also exists: tests/compile-check-real.sh — spins a throwaway
# PG container and runs the real 04_migrate.sql/05_rollback.sql. No replica.)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(dirname "$HERE")"
FILES=("$PKG/04_migrate.sql" "$PKG/05_rollback.sql")
FAILS=0

check_file(){
  local f="$1"
  awk '
    # skip pure-comment lines
    /^[[:space:]]*--/ { next }
    # start capturing at a RAISE statement
    buf == "" && /RAISE[[:space:]]+(EXCEPTION|NOTICE|WARNING|INFO|LOG|DEBUG)/ { buf = $0 }
    # continue capturing (already started, line did not start one)
    buf != "" && $0 != buf && !/RAISE[[:space:]]+(EXCEPTION|NOTICE|WARNING|INFO|LOG|DEBUG)/ { buf = buf " " $0 }
    # statement terminator reached
    buf != "" && /;/ {
      stmt = buf; buf = ""
      # extract first single-quoted format string
      if (match(stmt, /'"'"'[^'"'"']*'"'"'/)) {
        fmt = substr(stmt, RSTART, RLENGTH)
        rest = substr(stmt, RSTART + RLENGTH)     # everything after the format string
      } else { next }                              # no format string → skip
      # placeholders = % after removing %% (literal percent)
      f2 = fmt; gsub(/%%/, "", f2); ph = gsub(/%/, "&", f2)
      # args: after fmt, strip leading spaces+comma and trailing ; and spaces
      sub(/;[[:space:]]*$/, "", rest); sub(/^[[:space:]]*,?[[:space:]]*/, "", rest)
      gsub(/[[:space:]]+$/, "", rest)
      if (rest == "") { args = 0 } else { n = split(rest, a, ","); args = n }
      status = (ph == args) ? "OK" : "FAIL"
      if (status == "FAIL") rc = 1
      printf "  %-4s ph=%d args=%d :: %s\n", status, ph, args, fmt
    }
    END { exit rc+0 }
  ' "$f"
}

for f in "${FILES[@]}"; do
  echo "== $(basename "$f") =="
  check_file "$f" || FAILS=1
done

echo ""
if [ "$FAILS" -eq 0 ]; then echo "RAISE-BALANCE: ALL RAISE STATEMENTS BALANCED"; exit 0
else echo "RAISE-BALANCE: MISMATCH FOUND (see FAIL above)"; exit 1; fi
