#!/bin/bash
# =============================================================================
# check-migration-journal.sh
# =============================================================================
# Verifies that every .sql file in lib/db/drizzle/ is registered in
# lib/db/drizzle/meta/_journal.json.
#
# WHY THIS EXISTS:
#   Migration files can be added to the drizzle/ folder manually (for hotfixes,
#   audit triggers, index changes, etc.) without being registered in the journal.
#   The drizzle-orm migrator only runs entries listed in the journal — so any
#   unregistered file is silently ignored on every deploy.
#
#   This script catches that gap in CI before it reaches production.
#
# Usage:
#   bash scripts/check-migration-journal.sh
#
# Exit codes:
#   0 — every .sql file is registered in the journal
#   1 — one or more .sql files are NOT in the journal (CI should fail)
#
# Files that are intentionally excluded from the journal:
#   rollback_*.sql  — manual rollback scripts, never run by the migrator
#
# =============================================================================

set -euo pipefail

DRIZZLE_DIR="lib/db/drizzle"
JOURNAL="$DRIZZLE_DIR/meta/_journal.json"

# ── Colour codes (disabled in CI if NO_COLOR is set) ─────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED="\033[0;31m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RESET="\033[0m"
else
  RED="" GREEN="" YELLOW="" RESET=""
fi

echo ""
echo "=== Migration Journal Validation ==="
echo "Drizzle folder : $DRIZZLE_DIR"
echo "Journal file   : $JOURNAL"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────

if [ ! -d "$DRIZZLE_DIR" ]; then
  echo -e "${RED}ERROR: drizzle directory not found: $DRIZZLE_DIR${RESET}"
  exit 1
fi

if [ ! -f "$JOURNAL" ]; then
  echo -e "${RED}ERROR: journal not found: $JOURNAL${RESET}"
  exit 1
fi

# ── Extract registered tags from journal ──────────────────────────────────────
# Uses python3 (available everywhere) to parse JSON reliably.
# Falls back to grep-based extraction if python3 is absent.

if command -v python3 &>/dev/null; then
  registered_tags=$(python3 -c "
import json, sys
with open('$JOURNAL') as f:
    j = json.load(f)
for e in j.get('entries', []):
    print(e['tag'])
")
else
  # Fallback: grep + sed (less reliable but works for simple JSON)
  registered_tags=$(grep '"tag"' "$JOURNAL" | sed 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# ── Scan .sql files in drizzle folder ────────────────────────────────────────
unregistered=()
registered=()

while IFS= read -r sql_file; do
  filename=$(basename "$sql_file" .sql)

  # Skip rollback scripts — these are manual recovery files, not migrations
  if [[ "$filename" == rollback_* ]]; then
    echo -e "  ${YELLOW}SKIP${RESET}  $filename.sql  (rollback script — excluded)"
    continue
  fi

  # Skip meta directory contents
  if [[ "$sql_file" == *"/meta/"* ]]; then
    continue
  fi

  if echo "$registered_tags" | grep -qx "$filename"; then
    registered+=("$filename")
    echo -e "  ${GREEN}OK${RESET}    $filename.sql"
  else
    unregistered+=("$filename")
    echo -e "  ${RED}MISSING${RESET} $filename.sql  ← NOT in journal"
  fi

done < <(find "$DRIZZLE_DIR" -maxdepth 1 -name "*.sql" | sort)

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
echo "  Registered   : ${#registered[@]}"
echo "  Unregistered : ${#unregistered[@]}"
echo "─────────────────────────────────────────"

if [ ${#unregistered[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}FAIL: The following migration files are not registered in the journal:${RESET}"
  for f in "${unregistered[@]}"; do
    echo -e "  ${RED}→ $f.sql${RESET}"
  done
  echo ""
  echo "To fix: add an entry to lib/db/drizzle/meta/_journal.json for each file above."
  echo "Use a 'when' timestamp greater than the last entry in the journal."
  echo ""
  echo "Example entry:"
  echo '  {'
  echo '    "idx": <next_idx>,'
  echo '    "version": "7",'
  echo '    "when": <unix_ms>,'
  echo '    "tag": "<filename_without_.sql>",'
  echo '    "breakpoints": false'
  echo '  }'
  echo ""
  exit 1
fi

echo ""
echo -e "${GREEN}PASS: All migration files are registered in the journal.${RESET}"
echo ""
exit 0
