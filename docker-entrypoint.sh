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

# ── Starter content is OPT-IN (Product decision 2026-08-19) ───────────────────
# Document types and workflow templates are NO LONGER auto-seeded at startup.
# A new tenant begins empty; an admin loads a starter set on demand via
# POST /api/config/starter-templates. This keeps ArcScale industry-agnostic and
# prevents a boot restart from re-imposing defaults on tenants that removed them.
# The per-org seeding logic lives in lib/org-defaults.ts; the standalone scripts
# (seed-document-types.mjs / seed-wf-defaults.mjs) remain available for manual
# backfill if ever needed, but are intentionally NOT run automatically here.

# ── Start API server ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting API server..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
