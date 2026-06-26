# Production Hardening & Identity Stabilization — Roadmap
> Source: `Production Hardening & Identity Stabilization — Recommended Roadmap.odt`  
> Date: ~2026-05 (post-Replit, pre-production hardening)

## Guiding Principles
- Additive before destructive (new columns, new guards before removing anything)
- Production-safe (deployable with standard `git pull → docker compose build api → docker compose up -d`)
- Auditable (every significant identity event writes to audit_logs)
- Fail closed, not silent
- No overengineering (no new external services, no queue, no worker)

## Phase Overview

| Phase | Name | Risk | Urgency |
|-------|------|------|---------|
| H0 | Critical immediate fixes | None/trivial | Deploy now |
| H1 | Database integrity | Low, additive | This sprint |
| H2A | Identity stabilization — verification | Low, additive | This sprint |
| H2B | Identity stabilization — invitation flow | Medium, new flow | Next sprint |
| H2C | Observability & admin tooling | Low, additive | Next sprint |

## H0 — Critical Immediate Fixes (Zero Downtime)

### H0.1 — Disable `seedDefaultAdmin()` in production
```typescript
if (process.env.NODE_ENV !== "production") {
  seedDefaultAdmin().catch(...)
}
```
Prevents `admin@admin.com` / `owner@system.com` with hardcoded passwords from being created on every production restart.

### H0.2 — Disable `/api/dev/*` routes in production
```typescript
if (process.env.NODE_ENV !== "production") {
  app.use("/api/dev", devRouter);
}
```
Prevents `POST /api/dev/seed-full`, `/api/dev/clear-seed`, `/api/dev/seed-linked-scenario` in production.

### H0.3 — Bypass email verification for system_owner and admin
System owners and admins should not be blocked by email verification gates.

## Note on Current Status
H0.1 and H0.2 appear to be implemented in current code (NODE_ENV checks present). H2B (invitation flow) was implemented in commit `07af9b1`. Verify each phase against current code.
