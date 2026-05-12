#!/bin/bash
# =============================================================================
# check-disk.sh — VPS disk usage alert
# =============================================================================
#
# Cron (every 15 minutes):
#   */15 * * * * /var/www/edms/scripts/check-disk.sh >> /var/log/edms-monitor.log 2>&1
#
# Optional environment variables (set in /var/www/edms/.env or crontab):
#   ALERT_WEBHOOK     HTTP(S) URL to POST alert payload to (Slack, Discord, n8n, etc.)
#   ALERT_EMAIL       Email address to send alert to (requires mailutils/sendmail on VPS)
#   WARN_THRESHOLD    Disk % at which to warn (default: 75)
#   CRIT_THRESHOLD    Disk % at which to alert critically (default: 90)
#   MOUNT_POINT       Mount point to check (default: /)
#
# =============================================================================

set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/edms/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

WARN_THRESHOLD="${WARN_THRESHOLD:-75}"
CRIT_THRESHOLD="${CRIT_THRESHOLD:-90}"
MOUNT_POINT="${MOUNT_POINT:-/}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
HOSTNAME_LABEL="${HOSTNAME:-$(hostname)}"

USAGE=$(df "$MOUNT_POINT" | awk 'NR==2 {gsub(/%/,""); print $5}')
AVAIL=$(df -h "$MOUNT_POINT" | awk 'NR==2 {print $4}')
TOTAL=$(df -h "$MOUNT_POINT" | awk 'NR==2 {print $2}')

if [ "$USAGE" -ge "$CRIT_THRESHOLD" ]; then
  LEVEL="CRITICAL"
elif [ "$USAGE" -ge "$WARN_THRESHOLD" ]; then
  LEVEL="WARNING"
else
  exit 0
fi

MESSAGE="[${LEVEL}] ArcScale EDMS disk usage on ${HOSTNAME_LABEL}: ${USAGE}% (${AVAIL} free of ${TOTAL}) on ${MOUNT_POINT}"
echo "[check-disk] $(date): ${MESSAGE}"

if [ -n "$ALERT_WEBHOOK" ]; then
  curl -fsS --retry 2 --max-time 10 \
    -X POST "$ALERT_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"${MESSAGE}\"}" \
    > /dev/null || echo "[check-disk] WARN: Webhook delivery failed"
fi

if [ -n "$ALERT_EMAIL" ] && command -v mail &>/dev/null; then
  echo "$MESSAGE" | mail -s "[EDMS] Disk ${LEVEL}: ${USAGE}%" "$ALERT_EMAIL" \
    || echo "[check-disk] WARN: Email delivery failed"
fi
