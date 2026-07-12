# ADR 0005 — Redis / Horizontal Scaling Decision Gate

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** Owner (Product/Engineering), Architecture Review (Phase 2 Remediation)

---

## Context

The system is single-process, single-VPS: API + socket.io + cron schedulers + in-memory uploads in one Express process. Confirmed blockers to horizontal scaling:
- socket.io has **no adapter** (realtime breaks the moment a 2nd instance exists).
- Background jobs (`sendDueDateReminders`, `runScheduledSkills`, module-sync) run on `setInterval` with **no leader election** → a 2nd replica double-runs every job (duplicate notifications/emails).
- pg pool default `max=10`; login lockout + rate-limiters are per-process memory.

A single shared layer (Redis) resolves all four at once (socket adapter, distributed lock/leader election, shared rate-limit store), and later enables cache (R7) and queue (R8).

## Decision — explicit Decision Gate

**Redis becomes REQUIRED when ANY of the following is true:**
1. The deployment needs **more than one API instance** (availability/SLA), OR
2. Concurrent active users exceed what a single tuned instance + pool can serve (measured in Phase 8; provisional threshold: several hundred), OR
3. `audit_logs` write volume forces a write queue.

**Until a gate condition is met:** single instance + vertical scaling is the sanctioned posture. This is a **conscious ceiling**, documented — not an oversight. The first paying customer runs single-instance.

### Alternatives considered
- **Redis from day one** — premature complexity/dependency for a single-instance pilot. Rejected until a gate fires.
- **Postgres advisory locks (no Redis)** — covers cron leader-election but not realtime scaling. Weaker; only a stopgap.

## Consequences
- **Now:** none (documented ceiling). Shared-limiter *structure* may be built in Phase 5 with in-memory impl, activated on Redis when a gate fires.
- **When gate fires (Phase 8):** Redis + socket adapter + leader election + shared limiter + pool tuning.
- The first SLA contract requiring availability beyond one instance triggers this gate **before** signing.
