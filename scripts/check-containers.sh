#!/bin/bash
# =============================================================================
# check-containers.sh — Docker container health check
# =============================================================================
#
# Cron (every 5 minutes):
#   */5 * * * * /var/www/edms/scripts/check-containers.sh >> /var/log/edms-monitor.log 2>&1
#
# Optional environment variables:
#   ALERT_WEBHOOK     HTTP(S) URL to POST alert payload to
#   ALERT_EMAIL       Email address for alerts
#   API_HEALTH_URL    Full URL to health endpoint (default: http://localhost:8080/api/health)
#
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
API_HEALTH_URL="${API_HEALTH_URL:-http://localhost:8080/api/health}"
HOSTNAME_LABEL="${HOSTNAME:-$(hostname)}"

CONTAINERS=("edms_api" "edms_postgres" "edms_frontend")
FAILED=()

for C in "${CONTAINERS[@]}"; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$C" 2>/dev/null || echo "not_found")
  if [ "$STATUS" != "running" ]; then
    FAILED+=("${C} (status: ${STATUS})")
  fi
done

# HTTP health check on the API endpoint
if command -v curl &>/dev/null; then
  HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "$API_HEALTH_URL" || echo "000")
  if [ "$HTTP_STATUS" != "200" ]; then
    FAILED+=("api_health_check (HTTP ${HTTP_STATUS} from ${API_HEALTH_URL})")
  fi
fi

if [ ${#FAILED[@]} -eq 0 ]; then
  exit 0
fi

MESSAGE="[ALERT] ArcScale EDMS container failure on ${HOSTNAME_LABEL}: ${FAILED[*]}"
echo "[check-containers] $(date): ${MESSAGE}"

if [ -n "$ALERT_WEBHOOK" ]; then
  PAYLOAD=$(printf '{"text":"%s"}' "${MESSAGE//\"/\\\"}")
  curl -fsS --retry 2 --max-time 10 \
    -X POST "$ALERT_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    > /dev/null || echo "[check-containers] WARN: Webhook delivery failed"
fi

if [ -n "$ALERT_EMAIL" ] && command -v mail &>/dev/null; then
  echo "$MESSAGE" | mail -s "[EDMS] Container ALERT: ${HOSTNAME_LABEL}" "$ALERT_EMAIL" \
    || echo "[check-containers] WARN: Email delivery failed"
fi
