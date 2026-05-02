#!/bin/sh
# Run on every container start.
#
# 1. Schema migration — applies any pending Drizzle SQL migration files from
#                       lib/db/drizzle/ using the drizzle-orm runtime migrator.
#                       No drizzle-kit CLI required.  Handles both fresh
#                       databases (runs all migrations) and existing databases
#                       (baselines the initial migration, then applies new ones).
#
# 2. Workflow seed    — inserts the 5 default workflow templates (Invoice,
#                       General, Correspondence, Contract, Drawing) for every
#                       organisation that doesn't have them yet.  Fully
#                       idempotent — existing templates are never touched.

set -e

# ── Step 1: Apply pending migrations ─────────────────────────────────────────
echo "[entrypoint] Running database migrations..."
node --enable-source-maps /app/artifacts/api-server/dist/migrate.mjs && \
  echo "[entrypoint] Migrations complete." || {
  echo "[entrypoint] ERROR: Migration failed — aborting startup."
  exit 1
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
