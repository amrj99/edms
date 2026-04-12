#!/bin/bash
# =============================================================================
# ArcScale EDMS — Production Deploy Script
# =============================================================================
# Usage:
#   cd /var/www/edms && bash deploy.sh
#
# What it does:
#   1. Pulls latest code from GitHub
#   2. Applies the full safe SQL migration (handles all missing tables/columns)
#   3. Rebuilds the API Docker image with latest code (bakes in current schema)
#   4. Restarts the API container (entrypoint runs drizzle-kit push for final sync)
#   5. Verifies the API is healthy
#
# The SQL migration + image rebuild combination guarantees full schema alignment.
# =============================================================================

set -e

COMPOSE_FILE="/var/www/edms/docker-compose.yml"
DB_CONTAINER="edms_postgres"
DB_USER="edms"
DB_NAME="edms"
MIGRATION_FILE="/var/www/edms/migrate_production.sql"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        ArcScale EDMS — Production Deploy             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Pull latest code ──────────────────────────────────────────────────
echo "► [1/5] Pulling latest code from GitHub..."
git pull
echo "  ✓ Code updated."

# ── Step 2: Apply SQL migration ───────────────────────────────────────────────
echo "► [2/5] Applying full schema migration..."
if [ -f "$MIGRATION_FILE" ]; then
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$MIGRATION_FILE"
  echo "  ✓ Migration applied."
else
  echo "  ⚠ migrate_production.sql not found — skipping SQL migration."
fi

# ── Step 3: Rebuild ALL images (API + Frontend) ───────────────────────────────
echo "► [3/5] Rebuilding API and frontend images with latest code..."
docker compose -f "$COMPOSE_FILE" build --no-cache api frontend
echo "  ✓ Images rebuilt."

# ── Step 4: Restart containers ────────────────────────────────────────────────
echo "► [4/5] Restarting API and frontend containers..."
docker compose -f "$COMPOSE_FILE" up -d api frontend
echo "  ✓ Containers started."

# ── Step 5: Health check ──────────────────────────────────────────────────────
echo "► [5/5] Waiting for API to become healthy..."
for i in $(seq 1 20); do
  sleep 3
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' edms_api 2>/dev/null || echo "starting")
  echo "  ... attempt $i/20 — status: $STATUS"
  if [ "$STATUS" = "healthy" ]; then
    echo ""
    echo "  ✓ API is healthy and serving requests."
    break
  fi
  if [ "$i" = "20" ]; then
    echo "  ⚠ API did not reach healthy status in time. Check logs:"
    echo "    docker compose logs --tail=30 api"
  fi
done

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Deploy complete. To view API logs:"
echo "    docker compose logs --tail=30 api"
echo "══════════════════════════════════════════════════════"
echo ""
