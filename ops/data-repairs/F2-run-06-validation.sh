#!/usr/bin/env bash
# F2-run-06-validation.sh — Post-Repair Functional Validation (06) runner.
# READ-ONLY: no DB writes, no account creation, no rollback, no cleanup.
# Proves, over real HTTP, that the 7 migrated links serve to an authorized org-1
# user (200 + exact size) and are denied to a different-org user (403/404 only).
#
# Security (per owner requirements):
#  - tokens are read INTERACTIVELY and HIDDEN (read -s); never taken from argv/export
#  - tokens are NEVER printed (no echo, no set -x, curl stderr suppressed)
#  - tokens are passed to curl via 0600 config files (-K), never on the command line
#  - temp files live in a 0700 mktemp dir, removed on success/failure/Ctrl+C (trap)
#  - secret env vars are unset as soon as the config files hold them
#  - fail-closed: any deviation => non-zero exit
#
# Lives OUTSIDE the frozen package; reads the same source of truth (mapping.gen.tsv)
# and physical dst dir (config.sh). Run ON the VPS (needs docker for size ref).
set -uo pipefail
umask 077

PKG="${PKG:-/var/www/edms/ops/data-repairs/F2-legacy-storage-path}"
APP_CONTAINER="${APP_CONTAINER:-edms_api}"
GEN="$PKG/mapping.gen.tsv"

# PHYSICAL_DST_DIR from the package config (single source of truth)
[ -f "$PKG/config.sh" ] && . "$PKG/config.sh"
DST_DIR="${PHYSICAL_DST_DIR:-/app/uploads/1/1/document}"

WORK="$(mktemp -d)"; chmod 700 "$WORK"
cleanup(){ rm -rf "$WORK" 2>/dev/null || true; unset AUTH_TOKEN OTHER_TOKEN 2>/dev/null || true; }
trap cleanup INT TERM EXIT

fail(){ echo "VALIDATION ABORT: $*" >&2; exit 2; }

# (10) BASE_URL required + must be HTTPS
BASE_URL="${BASE_URL:-}"
[ -n "$BASE_URL" ] || fail "BASE_URL not set (export BASE_URL=https://<host>)"
case "$BASE_URL" in https://*) ;; *) fail "BASE_URL must be https://" ;; esac

# mapping present + exactly 7 rows
[ -f "$GEN" ] || fail "mapping.gen.tsv missing at $GEN"
rows="$(awk -F'\t' 'NF==7' "$GEN" | wc -l | tr -d ' ')"
[ "$rows" -eq 7 ] || fail "mapping.gen.tsv has $rows rows (expected 7)"

# (1)(2) interactive + hidden token capture — not argv, not export
printf 'AUTH_TOKEN  (org-1 authorized user) — input hidden: ' >&2
read -rs AUTH_TOKEN; echo >&2
printf 'OTHER_TOKEN (different-org user)    — input hidden: ' >&2
read -rs OTHER_TOKEN; echo >&2
[ -n "${AUTH_TOKEN:-}" ]  || fail "empty AUTH_TOKEN"
[ -n "${OTHER_TOKEN:-}" ] || fail "empty OTHER_TOKEN"

# (3)(4) tokens into 0600 curl config files (kept out of argv/ps), trap-removed
AUTH_CFG="$WORK/auth.cfg"; OTHER_CFG="$WORK/other.cfg"
( umask 077; : > "$AUTH_CFG"; : > "$OTHER_CFG"; chmod 600 "$AUTH_CFG" "$OTHER_CFG" )
printf 'header = "Authorization: Bearer %s"\n' "$AUTH_TOKEN"  > "$AUTH_CFG"
printf 'header = "Authorization: Bearer %s"\n' "$OTHER_TOKEN" > "$OTHER_CFG"
# (5) drop secrets from env immediately (config files hold them now)
unset AUTH_TOKEN OTHER_TOKEN

echo "== F2 POST-REPAIR FUNCTIONAL VALIDATION (06) =="
echo "base_url=$BASE_URL  app_container=$APP_CONTAINER  dst_dir=$DST_DIR  rows=$rows"

pass=0; n=0; overall=0
while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  [ -z "${new_url:-}" ] && continue
  n=$((n+1))
  echo "── [$tbl #$id] $new_url ──"

  # physical size reference from the served dir (read-only)
  ref="$(docker exec "$APP_CONTAINER" stat -c %s "$DST_DIR/$filename" 2>/dev/null || echo '')"
  if [ -z "$ref" ]; then echo "  ✗ cannot stat dst size for $filename"; overall=1; continue; fi

  # (7a) authorized download → 200 + exact size
  dl="$WORK/dl.bin"
  code="$(curl -sS -K "$AUTH_CFG" -o "$dl" -w '%{http_code}' "$BASE_URL$new_url" 2>/dev/null || echo '000')"
  got="$(stat -c %s "$dl" 2>/dev/null || echo 0)"; rm -f "$dl"
  auth_ok=0; { [ "$code" = "200" ] && [ "$got" = "$ref" ]; } && auth_ok=1
  echo "  authorized: http=$code size_expected=$ref size_got=$got -> $([ "$auth_ok" -eq 1 ] && echo OK || echo FAIL)"

  # (7b) cross-org → 403 or 404 ONLY (isolation)
  ocode="$(curl -sS -K "$OTHER_CFG" -o /dev/null -w '%{http_code}' "$BASE_URL$new_url" 2>/dev/null || echo '000')"
  iso_ok=0; { [ "$ocode" = "403" ] || [ "$ocode" = "404" ]; } && iso_ok=1
  echo "  cross-org : http=$ocode -> $([ "$iso_ok" -eq 1 ] && echo DENIED-OK || echo LEAK-FAIL)"

  if [ "$auth_ok" -eq 1 ] && [ "$iso_ok" -eq 1 ]; then pass=$((pass+1)); else overall=1; fi
done < <(awk -F'\t' 'NF==7' "$GEN")

echo ""
echo "VALIDATED_ROWS=$pass/$n"
[ "$n" -eq 7 ]    || { echo "FAIL: expected 7 rows, saw $n"; overall=1; }
[ "$pass" -eq 7 ] || { echo "FAIL: only $pass/7 rows passed both checks"; overall=1; }
if [ "$overall" -eq 0 ]; then echo "RESULT: PASS — 7/7 authorized-download + cross-org-denied"; else echo "RESULT: FAIL"; fi
VALIDATION_EXIT="$overall"
echo "VALIDATION_EXIT=$VALIDATION_EXIT"
exit "$VALIDATION_EXIT"
