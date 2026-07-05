#!/bin/bash
# =============================================================================
# deploy-production.sh — ArcScale EDMS production deployment
# =============================================================================
#
# Rebuilds and restarts ONLY the api and frontend containers.
# NEVER touches edms_postgres.
#
# Usage (run from /var/www/edms on the production VPS):
#   bash scripts/deploy-production.sh
#
# Pre-conditions (script will abort if any fail):
#   1. Working tree is clean (no uncommitted or untracked changes)
#   2. edms_postgres is running and healthy
#
# What it does:
#   1. Pre-checks (git clean, postgres health)
#   2. Stop and remove edms_api + edms_frontend (handles both labeled and
#      unlabeled containers to avoid Compose conflicts)
#   3. docker compose build api frontend
#   4. docker compose up -d --no-deps api frontend
#   5. Watch API startup logs for migration errors (10 s)
#   6. Health check via GET /api/health
#
# =============================================================================

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
API_CONTAINER="edms_api"
FRONTEND_CONTAINER="edms_frontend"
DB_CONTAINER="edms_postgres"
API_PORT="${API_PORT:-8088}"
HEALTH_URL="http://localhost:${API_PORT}/api/health"
LOG_TAIL_SECONDS=10

echo "══════════════════════════════════════════════════════"
echo " ArcScale EDMS — Production Deploy — $(date)"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Pre-check 1: working tree clean ──────────────────────────────────────────
echo "► [1/6] Git working tree check..."
if ! git diff --quiet HEAD 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  echo ""
  echo "  ABORT: Working tree is not clean."
  echo "  Commit or stash all changes before deploying."
  echo ""
  git status --short
  exit 1
fi
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "  ✓ Working tree clean. Deploying commit: ${CURRENT_COMMIT}"
echo ""

# ── Pre-check 2: postgres running and healthy ─────────────────────────────────
echo "► [2/6] Postgres health check..."
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo ""
  echo "  ABORT: '${DB_CONTAINER}' is not running."
  echo "  Start postgres with: docker compose up -d postgres"
  exit 1
fi

POSTGRES_HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "${DB_CONTAINER}" 2>/dev/null || echo "unknown")
if [ "${POSTGRES_HEALTH}" != "healthy" ]; then
  echo ""
  echo "  ABORT: '${DB_CONTAINER}' health status is '${POSTGRES_HEALTH}' (expected 'healthy')."
  echo "  Check logs with: docker logs ${DB_CONTAINER}"
  exit 1
fi
echo "  ✓ ${DB_CONTAINER} is running and healthy."
echo ""

# ── Step 3: Stop and remove api + frontend ────────────────────────────────────
echo "► [3/6] Stopping and removing api + frontend containers..."
for CONTAINER in "${API_CONTAINER}" "${FRONTEND_CONTAINER}"; do
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "  Stopping ${CONTAINER}..."
    docker stop "${CONTAINER}" 2>/dev/null || true
    docker rm   "${CONTAINER}" 2>/dev/null || true
    echo "  Removed ${CONTAINER}."
  else
    echo "  ${CONTAINER} not found — skipping."
  fi
done
echo ""

# ── Step 4: Build ─────────────────────────────────────────────────────────────
echo "► [4/6] Building api and frontend images..."
docker compose -f "${COMPOSE_FILE}" build api frontend
echo "  ✓ Build complete."
echo ""

# ── Step 5: Start containers ──────────────────────────────────────────────────
echo "► [5/6] Starting api and frontend..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps api frontend
echo "  ✓ Containers started."
echo ""

# ── Step 6a: Watch API startup logs for migration errors ─────────────────────
echo "► [6/6] Watching API startup logs (${LOG_TAIL_SECONDS}s)..."
echo "───────────────────────────────────────────────────────"

# Collect logs for 10 seconds, then stop
API_LOGS=$(timeout "${LOG_TAIL_SECONDS}" docker logs -f "${API_CONTAINER}" 2>&1 || true)
echo "${API_LOGS}"
echo "───────────────────────────────────────────────────────"

if echo "${API_LOGS}" | grep -qi "fatal migration error\|migration.*error\|ECONNREFUSED\|ENOTFOUND\|already exists\|does not exist"; then
  echo ""
  echo "  WARNING: Possible migration or startup error detected in logs above."
  echo "  Inspect with: docker logs ${API_CONTAINER}"
  echo "  Continuing to health check..."
fi
echo ""

# ── Step 6b: Health check ─────────────────────────────────────────────────────
echo "  Health check: ${HEALTH_URL}"
RETRY=0
MAX_RETRIES=6
RETRY_DELAY=5

until curl -sf "${HEALTH_URL}" > /dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ "${RETRY}" -gt "${MAX_RETRIES}" ]; then
    echo ""
    echo "  FAIL: API did not become healthy after $((MAX_RETRIES * RETRY_DELAY))s."
    echo "  Check logs with: docker logs ${API_CONTAINER}"
    exit 1
  fi
  echo "  Waiting for API... (attempt ${RETRY}/${MAX_RETRIES})"
  sleep "${RETRY_DELAY}"
done

HEALTH_BODY=$(curl -sf "${HEALTH_URL}" 2>/dev/null || echo "{}")
echo "  ✓ API healthy: ${HEALTH_BODY}"
echo ""

echo "══════════════════════════════════════════════════════"
echo " Deploy complete: commit ${CURRENT_COMMIT} @ $(date)"
echo "══════════════════════════════════════════════════════"
