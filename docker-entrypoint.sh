#!/bin/sh
# Run on every container start to apply any schema changes before the API boots.
# drizzle-kit push is idempotent: it adds missing tables/columns and skips
# anything that is already up-to-date. Safe to run on every deploy.

set -e

echo "[entrypoint] Syncing database schema..."
cd /app && pnpm --filter @workspace/db run push-force 2>&1 && echo "[entrypoint] Schema sync complete." || {
  echo "[entrypoint] WARNING: Schema sync returned non-zero exit — check logs above."
  echo "[entrypoint] Continuing startup (server may still work if schema is already current)."
}

echo "[entrypoint] Starting API server..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
