#!/usr/bin/env bash
# 0032-rollback.sh — targeted 0032 DATA rollback (fail-closed), driven by a
# pre-image CSV. Deterministic: it `docker cp`s the chosen artifact to a FIXED
# in-container path, runs the fail-closed rollback SQL (DB-identity check +
# row-guard: never clobbers a value changed since 0032), then removes the copy.
#
# ⚠️ This is a CHANGE tool. It reverts data. Do NOT run against production until
# it has been drilled on a RESTORED copy (see the test plan in the gate doc) and
# you have explicitly approved a rollback.
#
# Usage (on the VPS):
#   DRY-RUN (read-only preview, reverts nothing):
#     bash scripts/ops/0032-rollback.sh --dry-run /path/to/0032_preimage_*.csv
#   REAL (reverts data; typed confirmation required):
#     bash scripts/ops/0032-rollback.sh /path/to/0032_preimage_*.csv
#
# TEST PLAN (required before any production rollback): restore the latest dump into
# a throwaway container, set DB_CONTAINER to it, apply 0032 there, then run this
# script (dry-run then real) against that container and confirm B1 reverts to NULL.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ROLLBACK_SQL="$REPO_ROOT/lib/db/drizzle/rollback_0032_backfill_document_files_org_id.sql"
IN_CONTAINER_CSV="/tmp/_rb0032_artifact.csv"
# shellcheck source=scripts/ops/_0032-common.sh
source "$HERE/_0032-common.sh"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
CSV="${1:-}"
[ -n "$CSV" ] && [ -f "$CSV" ] || die "usage: $0 [--dry-run] <pre-image CSV>  (file not found: '${CSV:-<none>}')"
[ -f "$ROLLBACK_SQL" ] || die "rollback SQL not found: $ROLLBACK_SQL"

discover
cleanup() { docker exec "$DB_CONTAINER" sh -c "rm -f '$IN_CONTAINER_CSV'" 2>/dev/null || true; }
trap cleanup EXIT
log "Staging pre-image into container at $IN_CONTAINER_CSV"
docker cp "$CSV" "$DB_CONTAINER:$IN_CONTAINER_CSV"

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY-RUN — read-only preview on db=$DB_REAL_NAME ($DB_SYSID); reverts NOTHING (ends in ROLLBACK)."
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE _rb0032_artifact (
  file_id integer PRIMARY KEY, previous_organization_id integer, target_organization_id integer,
  document_id integer, project_id integer, captured_at timestamptz, database_name text, db_system_identifier text
) ON COMMIT DROP;
\copy _rb0032_artifact FROM '$IN_CONTAINER_CSV' CSV HEADER
SELECT count(*) AS artifact_rows FROM _rb0032_artifact;
SELECT count(*) AS would_revert FROM document_files df JOIN _rb0032_artifact a ON df.id=a.file_id
       WHERE df.organization_id = a.target_organization_id;
\echo '--- DIVERGED (would be SKIPPED, never overwritten) ---'
SELECT a.file_id, a.target_organization_id AS expected_from_0032, df.organization_id AS current_org
FROM _rb0032_artifact a JOIN document_files df ON df.id=a.file_id
WHERE df.organization_id IS DISTINCT FROM a.target_organization_id;
ROLLBACK;
SQL
  log "DRY-RUN done — nothing changed. Review 'would_revert' and DIVERGED above before a real rollback."
  exit 0
fi

# ── REAL rollback (reverts data) ─────────────────────────────────────────────
printf '[0032] REAL rollback on db=%s (system_identifier=%s) using:\n  %s\n' "$DB_REAL_NAME" "$DB_SYSID" "$CSV" >&2
printf '[0032] Type EXACTLY  ROLLBACK 0032  to proceed: ' >&2
read -r CONFIRM
[ "$CONFIRM" = "ROLLBACK 0032" ] || die "not confirmed — nothing done."

log "Running fail-closed rollback SQL (aborts on empty artifact / DB-identity mismatch; skips diverged rows)"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f - < "$ROLLBACK_SQL"
log "Rollback complete. Re-run the read-only classification to confirm B1 reverted to NULL and B2/B3/C/D/E unchanged."
