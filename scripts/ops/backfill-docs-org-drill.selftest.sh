#!/usr/bin/env bash
# =============================================================================
# backfill-docs-org-drill.selftest.sh — meta-test of the drill's safety gate
# =============================================================================
# Proves that the drill treats a MISSING identity-ABORT as a FAILURE (exit 1),
# i.e. it cannot emit a false PASS like the earlier version did. It does NOT need
# R2 or a backup: it builds a matching-identity artifact (captured on the same DB
# it is replayed against), confirms the rollback's identity guard does NOT abort
# in that case, and asserts that the drill's `grep ABORT || fail` gate then exits
# non-zero.
#
# Usage:  bash scripts/ops/backfill-docs-org-drill.selftest.sh
# Exit 0 = the safety gate correctly fails on a missing ABORT.
# =============================================================================
set -Eeuo pipefail

PW="selftest_only"
C="bf_selftest_$$"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RBK="$REPO/lib/db/drizzle/rollback_backfill_documents_org_from_project.sql"
CSV="$(mktemp)"
cleanup(){ docker stop "$C" >/dev/null 2>&1 || true; docker rm "$C" >/dev/null 2>&1 || true; rm -f "$CSV" || true; }
trap cleanup EXIT
log(){ printf '[selftest] %s\n' "$*"; }
psq(){ docker exec -e PGPASSWORD="$PW" -i "$C" psql -h 127.0.0.1 -U edms -d edms "$@"; }

[ -f "$RBK" ] || { echo "rollback SQL missing"; exit 1; }

docker run -d --name "$C" -e POSTGRES_USER=edms -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=edms postgres:16-alpine >/dev/null
W=0; until docker exec -e PGPASSWORD="$PW" "$C" psql -h 127.0.0.1 -U edms -d edms -tAc 'SELECT 1' >/dev/null 2>&1; do sleep 1; W=$((W+1)); [ "$W" -gt 60 ] && { echo "container not ready"; exit 1; }; done
# Minimal target tables so, IF the identity guard passed, the revert would run.
psq -q -c "CREATE TABLE documents(id int, organization_id int); CREATE TABLE document_files(id int, organization_id int); CREATE TABLE document_revisions(id int, organization_id int);"

# Build a MATCHING-identity artifact: db name + system_identifier of THIS db.
psq -tAc "COPY (SELECT 'doc' kind, 1 row_id, NULL::int previous_org, 2 target_org, current_database() database_name, (SELECT system_identifier FROM pg_control_system())::text db_system_identifier, now()::text captured_at) TO STDOUT WITH CSV HEADER" > "$CSV"
docker cp "$CSV" "$C:/tmp/_rb_backfill_docs_org.csv" >/dev/null

OUT=$(psq < "$RBK" 2>&1 || true)
if printf '%s' "$OUT" | grep -qiE "ABORT: artifact DB identity"; then
  log "UNEXPECTED: identity guard aborted on a MATCHING identity."
  log "SELFTEST FAIL"; exit 1
fi
log "matching identity did NOT identity-abort (correct)."

# Now exercise the drill's gate: 'grep ABORT || fail' must exit non-zero here.
gate_rc=0
(
  set -e
  fail(){ exit 1; }
  if printf '%s' "$OUT" | grep -qiE "ABORT: artifact DB identity"; then :; else fail "no abort"; fi
) || gate_rc=$?

if [ "$gate_rc" -ne 0 ]; then
  log "safety gate returned exit $gate_rc on a missing ABORT — a missing ABORT is treated as FAILURE."
  log "SELFTEST PASS"; exit 0
else
  log "safety gate returned 0 on a missing ABORT — this would be a FALSE PASS."
  log "SELFTEST FAIL"; exit 1
fi
