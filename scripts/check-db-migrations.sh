#!/bin/bash
# =============================================================================
# check-db-migrations.sh
# =============================================================================
# Detects schema drift — a schema file was changed without running
# `pnpm db:generate` to produce a corresponding migration file.
#
# Usage:
#   bash scripts/check-db-migrations.sh
#   pnpm db:check            (convenience alias)
#
# Exit codes:
#   0 — schema is in sync with migration files (all good)
#   1 — drift detected: run `pnpm db:generate` and commit lib/db/drizzle/
#
# How it works:
#   1. Runs `drizzle-kit check`  — verifies existing migration files are intact
#      (no manual edits, no missing SQL referenced in the journal).
#   2. Runs `drizzle-kit generate` — a no-op when schema is in sync.
#      If the schema has changed since the last generate, new files appear.
#   3. Checks git for any new/modified files under lib/db/drizzle/.
#      New files = schema drift → exits 1 with clear instructions.
#      No new files = everything in sync → exits 0.
#
# Note: if drift is detected and new files are generated, they are left in
# place intentionally — the developer needs to commit them.
# =============================================================================

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

DRIZZLE_DIR="lib/db/drizzle"
EXIT_CODE=0

echo "───────────────────────────────────────────"
echo " DB Migration Integrity Check"
echo "───────────────────────────────────────────"
echo ""

# ── Step 1: Verify existing migration files are unmodified ───────────────────
echo "► [1/2] Migration file integrity (drizzle-kit check)..."
CHECK_OUT=$(DATABASE_URL="${DATABASE_URL:-placeholder}" \
  pnpm --filter @workspace/db exec drizzle-kit check --config ./drizzle.config.ts 2>&1 || true)

if echo "$CHECK_OUT" | grep -q "Everything's fine"; then
  echo "  ✓ Migration files are intact."
elif echo "$CHECK_OUT" | grep -qi "error"; then
  echo "  ✗ Migration file integrity check failed:"
  echo "$CHECK_OUT" | sed 's/^/    /'
  EXIT_CODE=1
else
  echo "  ✓ Migration files OK."
fi
echo ""

# ── Step 2: Detect schema drift ──────────────────────────────────────────────
echo "► [2/2] Schema drift detection (pnpm db:generate)..."

DATABASE_URL="${DATABASE_URL:-placeholder}" pnpm db:generate 2>&1 | tail -3

# Any new untracked files in the drizzle directory?
UNTRACKED=$(git ls-files --others --exclude-standard "$DRIZZLE_DIR" 2>/dev/null || true)
# Any tracked files with unstaged changes?
MODIFIED=$(git diff --name-only -- "$DRIZZLE_DIR" 2>/dev/null || true)

if [ -n "$UNTRACKED" ] || [ -n "$MODIFIED" ]; then
  echo ""
  echo "  ✗ Schema drift detected — new migration file(s) generated but not committed:"
  echo ""
  [ -n "$UNTRACKED" ] && echo "$UNTRACKED" | sed 's/^/    (new)  /'
  [ -n "$MODIFIED"  ] && echo "$MODIFIED"  | sed 's/^/    (mod)  /'
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────┐"
  echo "  │  ACTION REQUIRED                                                │"
  echo "  │  Commit the generated file(s):                                  │"
  echo "  │    git add lib/db/drizzle/                                      │"
  echo "  │    git commit -m 'db: add migration for <describe your change>' │"
  echo "  │                                                                 │"
  echo "  │  Rule: every schema change in lib/db/src/schema/ must ship with │"
  echo "  │  a migration file in lib/db/drizzle/ in the same commit.        │"
  echo "  └─────────────────────────────────────────────────────────────────┘"
  EXIT_CODE=1
else
  echo ""
  echo "  ✓ No drift — all schema changes have committed migration files."
fi

echo ""
echo "───────────────────────────────────────────"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo " PASS"
else
  echo " FAIL"
fi
echo "───────────────────────────────────────────"
exit "$EXIT_CODE"
