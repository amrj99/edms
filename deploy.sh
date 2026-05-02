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
#   6. Verifies required env vars are present inside the running api container
#   7. (Optional) Purges Cloudflare cache — set CF_API_TOKEN + CF_ZONE_ID in .env
# =============================================================================

set -e

COMPOSE_FILE="/var/www/edms/docker-compose.yml"
DB_CONTAINER="edms_postgres"
DB_USER="edms"
DB_NAME="edms"
MIGRATION_FILE="/var/www/edms/migrate_production.sql"
API_CONTAINER="edms_api"

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
echo "► [1/7] Pulling latest code from GitHub..."
git pull
GIT_HASH=$(git rev-parse --short HEAD)
GIT_FULL=$(git rev-parse HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "  ✓ Code updated."
echo "  → Commit : $GIT_FULL"
echo "  → Short  : $GIT_HASH"
echo "  → Built  : $BUILD_TIME"

# ── Step 2: Migrations (automatic via Docker entrypoint) ──────────────────────
# HOW THE MIGRATION SYSTEM WORKS:
#   • Migration SQL files live in  lib/db/drizzle/  (e.g. 0000_init.sql, 0001_incremental.sql)
#   • The journal at  lib/db/drizzle/meta/_journal.json  lists every migration in order.
#   • On every container start the entrypoint runs  node dist/migrate.mjs  which uses
#     drizzle-orm's runtime migrator to apply any migration file not yet recorded in
#     the  drizzle.__drizzle_migrations  tracking table.
#   • Each migration file is applied exactly once and never re-run.
#   • All migration SQL uses  IF NOT EXISTS / DO EXCEPTION  guards — safe to run on
#     any DB state; never drops data.
#
# ─── MANDATORY WORKFLOW when changing the TypeScript schema ───────────────────
#   1. Edit the schema files in  lib/db/src/schema/
#   2. Run:  pnpm --filter @workspace/db generate
#            (or the shortcut:  pnpm db:generate  if configured at the root)
#      → drizzle-kit compares the schema against the latest snapshot and generates
#        a new numbered SQL file (e.g. 0002_add_xyz.sql) plus an updated snapshot.
#   3. git add lib/db/drizzle/  &&  git commit  &&  git push
#   4. bash deploy.sh
#      → the new migration runs automatically when the API container starts.
#
# ─── WHAT HAPPENS IF YOU SKIP STEP 2 ─────────────────────────────────────────
#   The production database will be missing the new columns/tables, causing 500
#   errors on every endpoint that touches the new schema.  Always run  db:generate.
#
# ─── Emergency manual fallback (if migrator itself is broken) ─────────────────
#   docker exec -i edms_postgres psql -U edms -d edms < migrate_production.sql
#   (migrate_production.sql is a cumulative safe-migration kept in sync manually)
echo "► [2/7] Migrations — applied automatically when API container starts."
echo "  ✓ No manual SQL step required (entrypoint runs dist/migrate.mjs)."

# ── Step 3: Rebuild ALL images (API + Frontend) ───────────────────────────────
# --no-cache: always rebuild from source, never reuse layer cache.
# --build-arg: bakes git hash + build time into the frontend bundle.
echo "► [3/7] Rebuilding API and frontend images with latest code..."
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
echo "► [4/7] Force-recreating API and frontend containers..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate api frontend
echo "  ✓ Containers recreated."

# ── Step 5: Health check ──────────────────────────────────────────────────────
echo "► [5/7] Waiting for API to become healthy..."
for i in $(seq 1 20); do
  sleep 3
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$API_CONTAINER" 2>/dev/null || echo "starting")
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

# ── Step 6: Env var verification ──────────────────────────────────────────────
# Checks that required env vars are actually visible inside the running container.
# This catches cases where .env was not loaded correctly or docker-compose.yml
# is missing a variable binding after an update.
echo "► [6/7] Verifying runtime environment inside api container..."
echo ""

# Critical secrets — must be set and must not be the insecure defaults
declare -A CRITICAL_VARS
CRITICAL_VARS["JWT_SECRET"]="edms-secret-key-change-in-production"
CRITICAL_VARS["REFRESH_TOKEN_SECRET"]="edms-refresh-key-change-in-production"

# Optional vars — warn if missing, but do not block
OPTIONAL_VARS=(
  "OPENROUTER_API_KEY"
  "RESEND_API_KEY"
  "FROM_EMAIL"
  "APP_URL"
)

ENV_PASS=true

echo "  ── Critical secrets ──────────────────────────────────"
for VAR in "${!CRITICAL_VARS[@]}"; do
  DEFAULT_VAL="${CRITICAL_VARS[$VAR]}"
  ACTUAL=$(docker exec "$API_CONTAINER" printenv "$VAR" 2>/dev/null || echo "")
  if [ -z "$ACTUAL" ]; then
    echo "  ✗ $VAR : NOT SET ← deploy will be blocked at API startup"
    ENV_PASS=false
  elif [ "$ACTUAL" = "$DEFAULT_VAL" ]; then
    echo "  ✗ $VAR : SET BUT USING INSECURE DEFAULT ← must be changed"
    ENV_PASS=false
  else
    MASKED="${ACTUAL:0:4}****"
    echo "  ✓ $VAR : present ($MASKED)"
  fi
done

echo ""
echo "  ── Optional / feature vars ───────────────────────────"
for VAR in "${OPTIONAL_VARS[@]}"; do
  ACTUAL=$(docker exec "$API_CONTAINER" printenv "$VAR" 2>/dev/null || echo "")
  if [ -z "$ACTUAL" ]; then
    # Map each var to its impact label
    case "$VAR" in
      OPENROUTER_API_KEY) LABEL="AI Analysis unavailable" ;;
      RESEND_API_KEY)     LABEL="Email notifications skipped" ;;
      FROM_EMAIL)         LABEL="Emails from sandbox address" ;;
      APP_URL)            LABEL="Email links may not resolve" ;;
      *)                  LABEL="feature degraded" ;;
    esac
    echo "  ⚠  $VAR : not set — $LABEL"
  else
    MASKED="${ACTUAL:0:6}****"
    echo "  ✓  $VAR : present ($MASKED)"
  fi
done

echo ""
if [ "$ENV_PASS" = false ]; then
  echo "  ╔═══════════════════════════════════════════════════════╗"
  echo "  ║  ACTION REQUIRED: Fix the critical env vars above     ║"
  echo "  ║  Edit /var/www/edms/.env, then run: bash deploy.sh   ║"
  echo "  ╚═══════════════════════════════════════════════════════╝"
else
  echo "  ✓ All critical env vars verified."
fi

# ── Step 7: Cloudflare cache purge (optional) ─────────────────────────────────
# Set CF_API_TOKEN and CF_ZONE_ID in /var/www/edms/.env to enable.
# (.env is already sourced at the top of this script)
echo "► [7/7] Cloudflare cache purge..."
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
