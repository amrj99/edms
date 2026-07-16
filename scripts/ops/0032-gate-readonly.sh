#!/usr/bin/env bash
# 0032-gate-readonly.sh — READ-ONLY 0032 production gate checks (A1–A4).
#
# Runs ONLY read queries and plan-only EXPLAIN. It performs ZERO writes — no
# data-changing statements, no data ingest, no migration. It produces one dated
# results folder + a single tarball to send back for analysis. Never prints
# secrets. (The CI guard test enforces the read-only guarantee.)
#
# Usage (on the VPS):   bash scripts/ops/0032-gate-readonly.sh
#   Optional overrides:  DB_CONTAINER=... DB_USER=... DB_NAME=... bash ...
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/_0032-common.sh
source "$HERE/_0032-common.sh"

discover
new_results_dir

log "A3 — DB identity"
pg_tbl "SELECT current_database() AS database_name,
        (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier;" \
  | tee "$RESULTS_DIR/A3_db_identity.txt"

log "A1 — classification counts (B1/B2/B3/C/D/E)"
pg_tbl "
WITH f AS (SELECT df.id file_id, df.organization_id file_org, d.organization_id doc_org, p.organization_id proj_owner
  FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id)
SELECT count(*) total,
 count(*) FILTER (WHERE file_org IS NULL AND doc_org=proj_owner)                              b1,
 count(*) FILTER (WHERE file_org IS NULL AND doc_org IS NULL)                                 b2,
 count(*) FILTER (WHERE file_org IS NULL AND doc_org IS NOT NULL AND doc_org<>proj_owner)     b3,
 count(*) FILTER (WHERE file_org=proj_owner)                                                  c_ok,
 count(*) FILTER (WHERE file_org IS NOT NULL AND file_org<>proj_owner)                        d_mismatch,
 count(*) FILTER (WHERE doc_org IS NOT NULL AND doc_org<>proj_owner)                          e_docdrift
FROM f;" | tee "$RESULTS_DIR/A1_classification.txt"

log "A2 — unresolved B2/B3/D/E detail (Data-Integrity record; no secrets)"
# klass is computed in the CTE and filtered with klass IS NOT NULL. This avoids
# SQL three-valued-logic pitfalls: a plain inequality on file_org would evaluate
# to NULL (not TRUE) for a NULL file_org and silently omit B2/B3 rows.
pg_tbl "
WITH f AS (SELECT df.id file_id, df.document_id, d.project_id, df.organization_id file_org,
  d.organization_id doc_org, p.organization_id proj_owner,
  CASE WHEN df.file_url LIKE '/api/storage/onpremise/%' THEN 'onpremise'
       WHEN df.file_url LIKE '/api/storage/s3-object/%' THEN 's3'
       WHEN df.file_url LIKE '/api/storage/r2-object/%' THEN 'r2' ELSE 'cloud' END storage_mode
  FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id),
g AS (SELECT *,
  CASE WHEN file_org IS NULL AND doc_org IS NULL THEN 'B2'
       WHEN file_org IS NULL AND doc_org IS NOT NULL AND doc_org<>proj_owner THEN 'B3'
       WHEN file_org IS NOT NULL AND file_org<>proj_owner THEN 'D'
       WHEN doc_org IS NOT NULL AND doc_org<>proj_owner THEN 'E' END klass
  FROM f)
SELECT file_id, document_id, project_id, file_org, doc_org, proj_owner AS project_owner_org, storage_mode, klass
FROM g WHERE klass IS NOT NULL ORDER BY klass, file_id;" | tee "$RESULTS_DIR/A2_unresolved.txt"

log "A4 — EXPLAIN (PLAN ONLY, no ANALYZE — plan is computed, nothing is written)"
pg_tbl "
EXPLAIN UPDATE document_files df SET organization_id=p.organization_id
 FROM documents d JOIN projects p ON p.id=d.project_id
 WHERE df.document_id=d.id AND df.organization_id IS NULL AND d.organization_id=p.organization_id;" \
  | tee "$RESULTS_DIR/A4_explain_plan.txt"

# ── Integrity of the results bundle ──────────────────────────────────────────
sha_dir "$RESULTS_DIR" > "$RESULTS_DIR/SHA256SUMS.txt"
printf 'NO PRODUCTION DATA WAS MODIFIED — read-only queries only (SELECT / EXPLAIN plan / COPY TO STDOUT).\n' \
  > "$RESULTS_DIR/ATTESTATION.txt"

TARBALL="$RESULTS_DIR.tar.gz"
tar -czf "$TARBALL" -C "$(dirname "$RESULTS_DIR")" "$(basename "$RESULTS_DIR")"
log "DONE. Send this one file back for analysis:"
printf '%s\n' "$TARBALL"
