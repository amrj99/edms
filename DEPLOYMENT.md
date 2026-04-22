# ArcScale EDMS — Production Deployment Guide

## Source of Truth

| What | Where |
|---|---|
| All application code (API + frontend) | GitHub `main` branch |
| Schema definition (authoritative) | `migrate_production.sql` in repo root |
| Schema diagnostic tool | `diagnose.sql` in repo root |
| Deploy automation | `deploy.sh` in repo root |

**GitHub is the only source of truth. Nothing exists or is applied outside of what is committed there.**

---

## Schema Policy

- `migrate_production.sql` is the **single migration file** that covers the entire database schema from scratch.
- Every statement uses `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS` — safe to run on a live database with existing data.
- Running it again on an already-migrated database is completely harmless.
- Schema changes in code (Drizzle schema files) **must always be accompanied by a matching update to `migrate_production.sql`** before the commit is pushed.
- `deploy.sh` runs `migrate_production.sql` automatically on every deploy (Step 2).

---

## Standard Deployment Procedure

For every production release, run one command on the VPS:

```bash
cd /var/www/edms && bash deploy.sh
```

This does all 7 steps automatically:

1. `git pull` — pulls latest code from GitHub, prints commit hash
2. SQL migration — runs `migrate_production.sql` against the live database
3. Rebuild — rebuilds API and frontend Docker images from scratch (`--no-cache`)
4. Restart — force-recreates API and frontend containers with the new images
5. Health check — polls `/api/health` until the API reaches healthy status
6. Env verification — confirms critical secrets are set and not left as defaults
7. Cloudflare purge — clears CDN cache if `CF_API_TOKEN` and `CF_ZONE_ID` are set

---

## Pre-Deploy Checklist

Run these before `bash deploy.sh`:

```bash
# 1. Confirm GitHub is up to date
git log origin/main --oneline -3

# 2. Run schema diagnostic — must return 0 rows in all sections
docker exec -i edms_postgres psql -U edms -d edms < diagnose.sql

# 3. Check disk space
df -h /var/www

# 4. Verify .env has required secrets (not default values)
grep -E "JWT_SECRET|REFRESH_TOKEN_SECRET" /var/www/edms/.env
```

---

## Deploy Command

```bash
cd /var/www/edms && bash deploy.sh
```

Expected output ends with:
```
✓ All critical env vars verified.
Deploy complete.
Commit : <hash>  |  Built : <timestamp>
```

---

## Post-Deploy Verification

```bash
# 1. API health
curl -s https://arcscale.org/api/health | python3 -m json.tool

# 2. Check all required tables exist (must return 0 rows)
docker exec -i edms_postgres psql -U edms -d edms < diagnose.sql

# 3. Confirm running container image matches expected commit
docker inspect edms_api | grep -A2 '"Image"'

# 4. Tail API logs for errors
docker compose -f /var/www/edms/docker-compose.yml logs --tail=50 api
```

---

## Rollback

If a deploy causes a problem, revert to the previous commit and redeploy:

```bash
cd /var/www/edms

# Find the previous good commit hash
git log --oneline -10

# Roll back code
git checkout <previous-commit-hash>

# Rebuild and restart with the previous code
docker compose -f docker-compose.yml build --no-cache api frontend
docker compose -f docker-compose.yml up -d --force-recreate api frontend

# Note: schema changes (new tables, new columns) cannot be automatically rolled back.
# IF the rollback target predates a schema change, the old code will simply ignore
# the new columns/tables — this is safe because all schema additions are backward-compatible.
```

---

## Default Credentials

| Account | Email | Password | Role |
|---|---|---|---|
| Primary Admin | admin@admin.com | Admin123! | admin |
| Backup Admin | owner@system.com | Owner123! | admin |

These accounts are auto-created on first startup if they do not exist.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret — must not be default |
| `REFRESH_TOKEN_SECRET` | Yes | Refresh token secret — must not be default |
| `NODE_ENV` | No | Set to `production` |
| `RESEND_API_KEY` | No | Email notifications |
| `OPENROUTER_API_KEY` | No | AI document analysis |
| `FROM_EMAIL` | No | Sender address for notifications |
| `APP_URL` | No | Public URL (used in email links) |
| `CF_API_TOKEN` | No | Cloudflare cache purge (optional) |
| `CF_ZONE_ID` | No | Cloudflare zone (optional) |
| `PHASE_D_ENFORCE_DEPT` | No | Set `true` to activate Phase D department enforcement |

---

## Health Check Endpoints

| Endpoint | Use |
|---|---|
| `GET /api/health` | Full health — DB ping, uptime, version |
| `GET /api/healthz` | Lightweight readiness probe |

---

## Architecture

```
Internet → nginx (port 80/443)
              ├── /api/* → API Server (port 8080) → PostgreSQL
              └── /*     → React SPA (static files, nginx-served)
```

---

## Feature Flags

| Flag | Default | Effect |
|---|---|---|
| `PHASE_D_ENFORCE_DEPT` | unset / `false` | Department-based access enforcement (Phase D). Set to `true` only after verifying shadow log data in `access_shadow_log`. |
