#!/bin/sh
# Run on every container start.
#
# 1. Schema sync  — drizzle-kit push applies any new tables/columns and skips
#                   anything already up-to-date.  Safe to run on every deploy.
#
# 2. Workflow seed — inserts the 5 default workflow templates (Invoice, General,
#                   Correspondence, Contract, Drawing) for every organisation
#                   that doesn't have them yet.  Fully idempotent — existing
#                   templates are never touched.

set -e

# ── Step 1: Schema sync ───────────────────────────────────────────────────────
echo "[entrypoint] Syncing database schema..."
cd /app && pnpm --filter @workspace/db run push-force 2>&1 && echo "[entrypoint] Schema sync complete." || {
  echo "[entrypoint] WARNING: Schema sync returned non-zero exit — check logs above."
  echo "[entrypoint] Continuing startup (server may still work if schema is already current)."
}

# ── Step 2: Seed default workflow templates ───────────────────────────────────
echo "[entrypoint] Seeding default workflow templates..."
node --enable-source-maps /app/artifacts/api-server/dist/seed-wf-defaults.mjs && \
  echo "[entrypoint] Workflow template seed complete." || {
  echo "[entrypoint] WARNING: Workflow template seed returned non-zero exit — check logs above."
  echo "[entrypoint] Continuing startup."
}

# ── Step 3: Start API server ──────────────────────────────────────────────────
echo "[entrypoint] Starting API server..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
