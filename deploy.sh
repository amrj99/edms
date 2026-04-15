#!/bin/bash
# =============================================================================
# ArcScale EDMS — Production Deploy Script
# =============================================================================
# Usage:
#   cd /var/www/edms && bash deploy.sh
#
# What it does:
#   1. Pulls latest code from GitHub + prints commit hash for verification
#   2. Applies the full safe SQL migration (handles all missing tables/columns)
#   3. Rebuilds API + Frontend images with --no-cache, stamping git hash + time
#   4. Force-recreates containers so the new image is always used
#   5. Verifies the API is healthy
#   6. (Optional) Purges Cloudflare cache — set CF_API_TOKEN + CF_ZONE_ID in .env
# =============================================================================

set -e

COMPOSE_FILE="/var/www/edms/docker-compose.yml"
DB_CONTAINER="edms_postgres"
DB_USER="edms"
DB_NAME="edms"
MIGRATION_FILE="/var/www/edms/migrate_production.sql"

# ── Load .env early so all variables (VITE_*, CF_*, etc.) are available ───────
# This must run before any step that needs env vars — especially the build step,
# because VITE_* vars must be passed as --build-arg to docker compose build.
if [ -f "/var/www/edms/.env" ]; then
  set -a; source /var/www/edms/.env; set +a
  echo "  ✓ .env loaded."
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        ArcScale EDMS — Production Deploy             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Pull latest code ──────────────────────────────────────────────────
echo "► [1/6] Pulling latest code from GitHub..."
git pull
GIT_HASH=$(git rev-parse --short HEAD)
GIT_FULL=$(git rev-parse HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "  ✓ Code updated."
echo "  → Commit : $GIT_FULL"
echo "  → Short  : $GIT_HASH"
echo "  → Built  : $BUILD_TIME"

# ── Step 2: Apply SQL migration ───────────────────────────────────────────────
echo "► [2/6] Applying full schema migration..."
if [ -f "$MIGRATION_FILE" ]; then
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$MIGRATION_FILE"
  echo "  ✓ Migration applied."
else
  echo "  ⚠ migrate_production.sql not found — skipping SQL migration."
fi

# ── Step 3: Rebuild ALL images (API + Frontend) ───────────────────────────────
# --no-cache: always rebuild from source, never reuse layer cache.
# --build-arg: bakes git hash + build time into the frontend bundle.
echo "► [3/6] Rebuilding API and frontend images with latest code..."
docker compose -f "$COMPOSE_FILE" build --no-cache \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  --build-arg GIT_HASH="$GIT_HASH" \
  --build-arg VITE_OWNER_NAME="${VITE_OWNER_NAME:-ArcScale EDMS}" \
  api frontend
echo "  ✓ Images rebuilt."

# ── Step 4: Force-recreate containers ────────────────────────────────────────
# --force-recreate ensures Docker always swaps to the newly built image,
# even if the compose spec (ports/volumes) hasn't changed. Without this,
# Docker may leave the old container running despite a new image existing.
echo "► [4/6] Force-recreating API and frontend containers..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate api frontend
echo "  ✓ Containers recreated."

# ── Step 5: Health check ──────────────────────────────────────────────────────
echo "► [5/6] Waiting for API to become healthy..."
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

# ── Step 6: Cloudflare cache purge (optional) ─────────────────────────────────
# Set CF_API_TOKEN and CF_ZONE_ID in /var/www/edms/.env to enable.
# (.env is already sourced at the top of this script)
echo "► [6/6] Cloudflare cache purge..."
if [ -n "$CF_API_TOKEN" ] && [ -n "$CF_ZONE_ID" ]; then
  PURGE_RESULT=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}')
  if echo "$PURGE_RESULT" | grep -q '"success":true'; then
    echo "  ✓ Cloudflare cache purged — all edges will fetch fresh content."
  else
    echo "  ⚠ Cloudflare purge failed: $PURGE_RESULT"
  fi
else
  echo "  ℹ CF_API_TOKEN / CF_ZONE_ID not set — skipping Cloudflare purge."
  echo "    To enable: add CF_API_TOKEN and CF_ZONE_ID to /var/www/edms/.env"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Deploy complete."
echo "  Commit : $GIT_HASH  |  Built : $BUILD_TIME"
echo ""
echo "  Verify in UI: the sidebar footer shows the commit hash."
echo "  Verify on VPS: docker inspect edms_frontend | grep -i created"
echo ""
echo "  To view API logs:"
echo "    docker compose logs --tail=30 api"
echo "══════════════════════════════════════════════════════"
echo ""
