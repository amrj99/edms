# EDMS — Deployment Guide

## Default Credentials

| Account | Email | Password | Role |
|---|---|---|---|
| Primary Admin | admin@admin.com | Admin123! | admin |
| Backup Admin | owner@system.com | Owner123! | admin |

> These accounts are auto-created on every startup if they don't exist.

---

## Quick Start (Docker)

### 1. Clone and configure environment

```bash
git clone <your-repo>
cd edms
cp .env.example .env
# Edit .env with your values — especially JWT_SECRET and POSTGRES_PASSWORD
```

### 2. Generate secure secrets

```bash
# JWT_SECRET
openssl rand -base64 64

# REFRESH_TOKEN_SECRET
openssl rand -base64 64

# POSTGRES_PASSWORD
openssl rand -base64 32
```

### 3. Build and start all services

```bash
docker compose up -d --build
```

Services started:
- PostgreSQL on port 5432
- API server on port 8080 (`/api/*`)
- Frontend (nginx) on port 80

### 4. Run database migrations and seed

```bash
# Migrations are applied automatically on startup via Drizzle push
# To run seed manually:
docker compose exec api node ./artifacts/api-server/dist/seed.mjs
```

### 5. Check health

```bash
curl http://localhost:8080/api/health
# Expected: {"status":"ok","database":"connected",...}
```

---

## VPS Deployment

### Prerequisites

- Ubuntu 22.04 or later
- Docker + Docker Compose v2
- Domain name (optional, for SSL)

### Steps

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Upload project to server
scp -r . user@your-server:/opt/edms

# 3. SSH in and configure
ssh user@your-server
cd /opt/edms
cp .env.example .env
nano .env  # Set secrets

# 4. Start
docker compose up -d --build

# 5. (Optional) Set up nginx reverse proxy with SSL
# Install certbot and nginx on the host, then proxy to localhost:80
```

### With SSL (Let's Encrypt)

```bash
# Install certbot
apt install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d yourdomain.com

# Update nginx.conf ALLOWED_ORIGINS in .env:
ALLOWED_ORIGINS=https://yourdomain.com
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | development | Set to `production` in prod |
| `PORT` | No | 8080 | API server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | dev default | JWT signing secret (change!) |
| `REFRESH_TOKEN_SECRET` | No | — | Refresh token secret |
| `ALLOWED_ORIGINS` | No | * (all) | Comma-separated allowed origins |
| `POSTGRES_PASSWORD` | Docker only | edms_dev_password | PostgreSQL password |
| `API_PORT` | Docker only | 8080 | External API port |
| `FRONTEND_PORT` | Docker only | 80 | External frontend port |

---

## Available Scripts

```bash
# Development
pnpm --filter @workspace/api-server run dev     # Start API server (dev mode)
pnpm --filter @workspace/edms run dev           # Start frontend (dev mode)

# Production build
pnpm --filter @workspace/api-server run build   # Build API server
pnpm --filter @workspace/edms run build         # Build frontend (dist/)

# Database
pnpm --filter @workspace/db run push            # Push schema changes
pnpm --filter @workspace/api-server run seed    # Run seed script

# Docker
docker compose up -d --build    # Build and start all services
docker compose down             # Stop all services
docker compose logs -f api      # Follow API server logs
docker compose logs -f frontend # Follow frontend logs
```

---

## Health Checks

| Endpoint | Description |
|---|---|
| `GET /api/health` | Full health check (DB ping, uptime, latency) |
| `GET /api/healthz` | Lightweight readiness probe |

---

## Architecture

```
Internet → nginx (port 80/443)
              ├── /api/* → API Server (port 8080) → PostgreSQL
              └── /* → React SPA (static files)
```
