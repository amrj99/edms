#!/usr/bin/env bash
# 0032-backup-verify.sh — pre-execution BACKUP + restore-drill for the 0032 gate.
#
# Writes ONLY backups (never modifies production data): full pg_dump → R2, files
# mirror → R2, and a restore-verification drill into a THROWAWAY container (never
# touching production). Also captures the pre-image artifact whose row count must
# equal the B1 count from the read-only gate. Never prints secrets.
#
# Usage (on the VPS):   bash scripts/ops/0032-backup-verify.sh
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$HERE/.." && pwd)"           # repo scripts/ (no hardcoded /var/www/edms)
# shellcheck source=scripts/ops/_0032-common.sh
source "$HERE/_0032-common.sh"

for s in backup.sh backup-files.sh restore-verify.sh; do
  [ -f "$SCRIPTS_DIR/$s" ] || die "expected $SCRIPTS_DIR/$s not found — run from the repo checkout."
done

discover
new_results_dir

log "B1 — full DB backup (→ R2) via your backup.sh"
bash "$SCRIPTS_DIR/backup.sh"        2>&1 | tee "$RESULTS_DIR/B1_db_backup.log"

log "B1b — files/storage backup (→ R2 files-mirror) via your backup-files.sh"
bash "$SCRIPTS_DIR/backup-files.sh"  2>&1 | tee "$RESULTS_DIR/B1b_files_backup.log"

log "B2 — restore-verification drill (throwaway container, NOT production)"
bash "$SCRIPTS_DIR/restore-verify.sh" 2>&1 | tee "$RESULTS_DIR/B2_restore_verify.log"

log "B3 — pre-image artifact (targeted-rollback key, self-identifying to this cluster)"
ART="$RESULTS_DIR/0032_preimage_${DB_REAL_NAME}_${DB_SYSID}_$(date -u +%Y%m%dT%H%M%SZ).csv"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "COPY (
  SELECT df.id AS file_id, df.organization_id AS previous_organization_id, p.organization_id AS target_organization_id,
         d.id AS document_id, d.project_id AS project_id, now() AS captured_at,
         current_database() AS database_name, (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier
  FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id
  WHERE df.organization_id IS NULL AND d.organization_id=p.organization_id
) TO STDOUT WITH CSV HEADER" > "$ART"
ART_ROWS=$(($(wc -l < "$ART") - 1))
log "Pre-image rows (excl header): $ART_ROWS  →  MUST equal b1 from the read-only gate (A1)."
printf 'preimage_rows=%s\n' "$ART_ROWS" | tee "$RESULTS_DIR/B3_preimage_rowcount.txt"

sha_dir "$RESULTS_DIR" > "$RESULTS_DIR/SHA256SUMS.txt"
log "DONE. Keep the pre-image CSV + the pg_dump SAFELY (rollback keys). Results: $RESULTS_DIR"
