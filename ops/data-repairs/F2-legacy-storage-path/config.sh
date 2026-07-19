#!/usr/bin/env bash
# config.sh — F2 canonical contract: the SINGLE SOURCE OF TRUTH for the four
# DISTINCT concepts in this repair. Sourced by every shell step so no path/prefix
# can drift between scripts again. Any value may be overridden via environment,
# but the defaults below are the audited production values (see README + dry-run
# evidence: bytes live at /1/0/, DB records /1/document, canonical target /1/1/).
#
# The four concepts are deliberately SEPARATE — do NOT collapse them:
#   DB_OLD_URL_PREFIX   what the DB currently stores in file_url (fs-path form,
#                       NO project segment). Used ONLY to match/guard DB rows.
#   DB_NEW_URL_PREFIX   the canonical serve-URL the DB must hold after migrate.
#   PHYSICAL_SRC_DIR    where the bytes ACTUALLY are on disk right now (the copy
#                       SOURCE). NOTE: this is NOT the same path as DB_OLD_URL_PREFIX.
#   PHYSICAL_DST_DIR    where the bytes must be so the serve route resolves
#                       DB_NEW_URL_PREFIX to them (the copy DESTINATION).

export DB_OLD_URL_PREFIX="${DB_OLD_URL_PREFIX:-/app/uploads/1/document}"
export DB_NEW_URL_PREFIX="${DB_NEW_URL_PREFIX:-/api/storage/onpremise/1/1/document}"
export PHYSICAL_SRC_DIR="${PHYSICAL_SRC_DIR:-/app/uploads/1/0/document}"
export PHYSICAL_DST_DIR="${PHYSICAL_DST_DIR:-/app/uploads/1/1/document}"

# Back-compat aliases: existing steps read SRC_DIR/DST_DIR = the PHYSICAL dirs.
export SRC_DIR="${SRC_DIR:-$PHYSICAL_SRC_DIR}"
export DST_DIR="${DST_DIR:-$PHYSICAL_DST_DIR}"
