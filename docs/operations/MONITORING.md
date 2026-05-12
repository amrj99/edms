# Operational Monitoring — ArcScale EDMS

> Three layers. Zero ongoing cost. Total setup time: one afternoon.
> No agents. No dashboards. No additional services to maintain.

---

## Architecture Overview

| Layer | Tool | What it monitors | Setup time | Cost |
|---|---|---|---|---|
| External availability | UptimeRobot | `/api/health` every 5 minutes | 15 minutes | Free |
| Backup integrity | healthchecks.io | Nightly cron success/failure | 30 minutes | Free |
| VPS system health | Cron scripts | Disk usage, container status | 1–2 hours | Free |

**What not to add yet:** Prometheus, Grafana, Datadog, Sentry, ELK, PagerDuty. These add operational complexity with no additional benefit at beta scale. Add them when you have a dedicated ops person or > 1,000 concurrent users.

---

## Layer 1: External Availability — UptimeRobot

UptimeRobot is a service that pings your application from external servers every 5 minutes. If your VPS goes down, your nginx crashes, or your API stops responding, you know within 5 minutes rather than when a client calls you.

**Why this is the most important monitor:** It's external to your VPS. It detects scenarios the VPS cannot detect about itself — host failure, network partition, Docker daemon crash, public DNS failure.

### Setup (15 minutes)

1. Go to https://uptimerobot.com and create a free account.

2. Click **Add New Monitor**.

3. Configure:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `ArcScale EDMS - API Health`
   - URL: `https://your-domain.com/api/health`
   - Monitoring Interval: **5 minutes**
   - Monitor Timeout: **30 seconds**

4. Under **Alert Contacts**, add your email. You will receive an email immediately when the monitor detects downtime and when it recovers.

5. Optionally add a second monitor for the frontend:
   - URL: `https://your-domain.com`
   - Monitor Type: **HTTP(s)**

### What `/api/health` returns

The health endpoint returns:
```json
{
  "status": "ok",
  "timestamp": "2026-05-12T02:00:00.000Z",
  "database": "connected"
}
```

UptimeRobot checks for HTTP 200. Any non-200 response or connection failure triggers an alert.

### Alert thresholds

| Condition | Action |
|---|---|
| 1 failed check | No alert (may be transient) |
| 2 consecutive failed checks (10 minutes down) | Email alert |
| Recovery | Email confirmation |

UptimeRobot free tier uses 5-minute intervals and sends up to 20 email notifications per month.

---

## Layer 2: Backup Integrity — healthchecks.io

healthchecks.io uses a "dead-man's switch" pattern. Instead of the monitoring service polling your backup, your backup script pings the monitoring service after successful completion. Silence is the alert — if no ping arrives within the configured window, you receive an email.

This catches: cron job not running, backup script crashing, R2 upload failure, Docker daemon crash during backup, disk full preventing the dump.

### Setup (30 minutes)

1. Go to https://healthchecks.io and create a free account.

2. Click **Add Check**.

3. Configure:
   - Name: `EDMS Nightly Backup`
   - Schedule: **Simple**, Period: **25 hours**, Grace: **1 hour**
   - (25h gives the daily cron a 1-hour window to complete before alerting)

4. Click **Save**. Copy the ping URL (format: `https://hc-ping.com/your-uuid`).

5. Add to `/var/www/edms/.env` on the VPS:
   ```
   HEALTHCHECK_URL=https://hc-ping.com/your-uuid-here
   ```

6. Set up email notifications in healthchecks.io under **Account → Integrations**.

7. Run the backup manually to confirm the ping works:
   ```bash
   bash /var/www/edms/scripts/backup.sh
   ```
   Check the healthchecks.io dashboard — the check should show green.

### Alert thresholds

| Condition | Action |
|---|---|
| No ping for 25 hours | Email alert |
| Ping received after alert | Recovery email |

### Manual ping for testing

```bash
curl https://hc-ping.com/your-uuid
```

Expected: HTTP 200 with body `OK`.

---

## Layer 3: VPS System Health — Cron Scripts

Two lightweight scripts run on the VPS to detect local system issues that UptimeRobot cannot see (disk filling up, containers restarting).

### Disk usage monitoring

**Script:** `scripts/check-disk.sh`

**Cron schedule:** Every 15 minutes.

```bash
crontab -e
```

Add:
```
*/15 * * * * /var/www/edms/scripts/check-disk.sh >> /var/log/edms-monitor.log 2>&1
```

**Thresholds:**

| Level | Default threshold | Meaning |
|---|---|---|
| WARNING | 75% | You have roughly 25% headroom. Investigate and plan. |
| CRITICAL | 90% | Imminent failure. Act immediately. |

The script exits silently if disk usage is below the warning threshold, so it only produces log output when there is an actual issue.

**Configure alerts:**

Option A — Slack webhook (recommended for teams):
```
ALERT_WEBHOOK=https://hooks.slack.com/services/your/slack/webhook
```

Option B — Email (requires mailutils on VPS):
```bash
apt-get install -y mailutils
```
```
ALERT_EMAIL=your@email.com
```

Option C — No alerts configured yet: the script logs to `/var/log/edms-monitor.log` and you check manually.

**Common disk consumers to investigate when threshold is reached:**

```bash
# Top directories by size
du -sh /var/lib/docker/volumes/* | sort -h

# Docker logs (can grow large)
du -sh /var/lib/docker/containers/*/

# API server logs
docker logs edms_api 2>&1 | wc -l

# Clean up old Docker resources
docker system prune --volumes  # CAUTION: removes unused volumes — verify first
```

### Container health monitoring

**Script:** `scripts/check-containers.sh`

**Cron schedule:** Every 5 minutes.

```bash
crontab -e
```

Add:
```
*/5 * * * * /var/www/edms/scripts/check-containers.sh >> /var/log/edms-monitor.log 2>&1
```

**What it checks:**
1. `edms_api` container status — must be `running`
2. `edms_postgres` container status — must be `running`
3. `edms_frontend` container status — must be `running`
4. HTTP GET on `/api/health` — must return HTTP 200

**If a container alert fires:**

```bash
# Check container status
docker ps -a | grep edms

# Check recent logs for the failed container
docker logs edms_api --tail=50
docker logs edms_postgres --tail=50

# Restart a crashed container
docker compose restart api

# Full restart
docker compose down && docker compose up -d
```

---

## Cron Job Summary

After setup, your crontab should look like:

```
# ArcScale EDMS monitoring
*/5  * * * * /var/www/edms/scripts/check-containers.sh >> /var/log/edms-monitor.log 2>&1
*/15 * * * * /var/www/edms/scripts/check-disk.sh      >> /var/log/edms-monitor.log 2>&1

# ArcScale EDMS backup
0 2 * * * /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1
```

---

## Log Rotation

Without rotation, `/var/log/edms-backup.log` and `/var/log/edms-monitor.log` will grow indefinitely.

Create `/etc/logrotate.d/edms`:

```
/var/log/edms-backup.log
/var/log/edms-monitor.log
{
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
}
```

This keeps 30 days of compressed logs and rotates daily.

---

## Alert Threshold Rationale

| Metric | Threshold | Why |
|---|---|---|
| API health check | 2 consecutive failures (10 min) | 1 failure may be transient network; 2 confirms real downtime |
| Disk warning | 75% | At typical VPS sizes (50–100 GB), 75% gives you time to act before things fail |
| Disk critical | 90% | Postgres writes can fail when disk is full, causing data loss |
| Container down | Immediate on next 5-min check | Container failure is never transient — always investigate |
| Backup dead-man | 25 hours (1 hour grace after daily 2am cron) | Confirms the nightly backup ran within the expected window |

---

## Escalation Path

For a solo operator or small team during beta:

1. UptimeRobot email → check VPS → restart containers if needed
2. Disk CRITICAL → immediately investigate top consumers → clean or expand disk
3. Backup dead-man fires → check `/var/log/edms-backup.log` → fix and run manually
4. Container down that won't restart → check logs → escalate to code fix if needed

No PagerDuty, no on-call rotation, no runbook escalation trees needed at this stage.
