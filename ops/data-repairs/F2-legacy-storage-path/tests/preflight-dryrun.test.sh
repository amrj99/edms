#!/usr/bin/env bash
# preflight-dryrun.test.sh — REGRESSION TEST (permanent) for the F2 data-repair package.
#
# Locks the dry-run contract so nobody later turns the dry-run back into fail-fast:
#   • DRY_RUN=1 (diagnostic): physical issues (missing source, dst conflict, …) are
#     RECORDED and the run COMPLETES (exit 0) with a PHYSICAL READINESS summary.
#   • Strict mode (DRY_RUN!=1): a missing source ABORTS (non-zero exit).
#   • Inventory integrity (7 rows / 4 unique) is produced regardless.
#
# Hermetic: a `docker` shell-function stub feeds a synthetic 7-row inventory and
# simulates the filesystem — NO real VPS / DB / Docker is touched. Runnable in CI
# or locally:  bash tests/preflight-dryrun.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(dirname "$HERE")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$PKG/01_preflight.sh" "$PKG/00_inventory.sql" "$WORK/"

# ── docker stub ───────────────────────────────────────────────────────────────
# Honours $MISSING (basename to treat as an unreadable source; empty = all present).
docker(){
  [ "${1:-}" = exec ] || return 99; shift
  while [ "${1:-}" = -i ] || [ "${1:-}" = -u ]; do [ "$1" = -u ] && shift 2 || shift; done
  local _c="$1"; shift; local cmd="${1:-}"
  case "$cmd" in
    psql)
      if printf '%s ' "$@" | grep -q -- '-f'; then
        # synthetic inventory: 7 rows, 4 unique files (a,b,c,d); c shared by 2 revisions
        # OLD contract = /app/uploads/1/document/<f>  ->  NEW = /api/storage/onpremise/1/1/document/<f>
        local b='/app/uploads/1/document'; local n='/api/storage/onpremise/1/1/document'
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_files            3  1 1 "$b/1699_a.pdf" "$n/1699_a.pdf" 1699_a.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_files            4  1 1 "$b/1699_b.pdf" "$n/1699_b.pdf" 1699_b.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_revisions        11 1 1 "$b/1699_a.pdf" "$n/1699_a.pdf" 1699_a.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_revisions        12 1 1 "$b/1699_b.pdf" "$n/1699_b.pdf" 1699_b.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_revisions        13 1 1 "$b/1699_c.pdf" "$n/1699_c.pdf" 1699_c.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' document_revisions        14 1 1 "$b/1699_c.pdf" "$n/1699_c.pdf" 1699_c.pdf
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' correspondence_attachments 5 1 1 "$b/1699_d.pdf" "$n/1699_d.pdf" 1699_d.pdf
      else
        echo "# db_identity: db=edms server=stub now=stub"
      fi ;;
    test) shift; local flag="${1:-}" path="${2:-}"
      case "$flag" in
        -d) return 0 ;;  # SRC_DIR exists
        -r) if [ -n "${MISSING:-}" ] && [ "$(basename "$path")" = "$MISSING" ]; then return 1; fi; return 0 ;;
        -e) case "$path" in /app/uploads/1|/app/uploads) return 0;; *) return 1;; esac ;;  # dst absent; ancestor exists
        -w) return 0 ;;
      esac ;;
    sh) echo 4 ;;             # SRC_DIR file count
    sha256sum) echo "stubhash  ${2:-}" ;;
    *) return 0 ;;
  esac
}

run_case(){ # $1=label  $2=DRY_RUN(1|0)  $3=MISSING(basename|"")
  OUT="$WORK/out.$1"
  ( cd "$WORK"
    export APP_CONTAINER=app DB_CONTAINER=db \
           SRC_DIR=/app/uploads/1/document DST_DIR=/app/uploads/1/1/document \
           DRY_RUN="$2" MISSING="$3"
    set --                 # clear positional params so sourced script sees no MANUAL_MAP ($1)
    source ./01_preflight.sh
  ) > "$OUT" 2>&1
  RC=$?
}

FAILS=0
assert(){ # $1=desc ; $2=condition-result(0/1)
  if [ "$2" -eq 0 ]; then echo "  PASS: $1"; else echo "  FAIL: $1"; FAILS=$((FAILS+1)); echo "  ---- output ----"; sed 's/^/    /' "$OUT"; fi
}
has(){ grep -qF "$1" "$OUT"; }

echo "== Case 1: DRY_RUN=1 with a missing source → diagnostic, no abort =="
run_case c1 1 1699_b.pdf
{ [ "$RC" -eq 0 ]; }; assert "exit 0 (did not fail-fast)" $?
has "READINESS = NOT READY" ; assert "reports NOT READY" $?
has "sources_present = 3/4" ; assert "counts 3/4 sources present" $?
has "mapping.gen.tsv = 7"   ; assert "inventory still produced (7 rows)" $?

echo "== Case 2: strict (DRY_RUN=0) with a missing source → abort =="
run_case c2 0 1699_b.pdf
{ [ "$RC" -ne 0 ]; }; assert "non-zero exit (fail-closed)" $?
has "PREFLIGHT ABORT" ; assert "aborts with PREFLIGHT ABORT" $?

echo "== Case 3: DRY_RUN=1 all present → READY =="
run_case c3 1 ""
{ [ "$RC" -eq 0 ]; }; assert "exit 0" $?
has "READINESS = READY (" ; assert "reports READY" $?
has "sources_present = 4/4" ; assert "counts 4/4 sources present" $?

echo ""
if [ "$FAILS" -eq 0 ]; then echo "ALL REGRESSION CASES PASSED"; exit 0
else echo "$FAILS ASSERTION(S) FAILED"; exit 1; fi
