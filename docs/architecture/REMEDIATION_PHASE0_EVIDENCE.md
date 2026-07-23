# Remediation Phase 0 — Evidence & Gate Record

**Date:** 2026-07-10 · **Branch:** `arch/remediation-phase-0-1`
Reference: Master Remediation Execution Blueprint. Read-only evidence gathering; no production access (VPS unreachable from repo — production-parallel confirmations require DBA).

---

## B0.1 — DB Role Privileges (F2)

Query (LOCAL `edms_postgres`, read-only):
```
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('edms','postgres');
```
Result:
```
 rolname | rolsuper | rolbypassrls
 edms    |    t     |     t
```
- App `DATABASE_URL` connects as `edms`.
- RLS present: **13 policies, 13 tables** with `relrowsecurity=true`.

**Finding F2 → CONFIRMED (local).** The application connects as a **superuser with BYPASSRLS**; the 13 RLS policies are structurally inert. This is stronger than "fail-open": RLS is bypassed at the role level regardless of context.
**Consequence (dependency proof):** flipping fail-open (B2.2) is worthless until a `NOBYPASSRLS` app role exists (B2.1). B2.1 MUST precede B2.2.
**Production:** same `docker-compose` (`POSTGRES_USER=edms`, stock image → superuser) ⇒ near-certain identical, **but requires DBA confirmation** on the VPS. Status: local Confirmed; prod Evidence-Required.

## B0.2 — Legitimate Bypass Inventory

Paths that run with **no tenant context** and must keep working under fail-closed RLS (via a privileged DB role, not the app role):

| Class | Paths |
|---|---|
| Startup (pre-listen) | `runIntegrityMigrations`, `initRlsPolicies`, `seedPlans`, `seedDefaultAdmin`, `backfillOrgConfig`, `resetModulesToPlan` (`bootstrap.ts`) |
| Cron (cross-tenant) | `sendDueDateReminders` (`reminder-job.ts`), `runScheduledSkills` (`skill-engine.ts`), module-sync-scheduler |
| Privileged role | `system_owner` (sees all orgs; `orgOverride`) — `org-scope.ts` |
| Migration runner | `ensureBaseline` / `repairStaleBaseline` / `migrate` (`migrate.ts`) |

App-layer scoping scale (F3): **42 route files** filter `organizationId` manually.

## B0.3 — Decision Gate ADRs
Recorded as `docs/adr/0003`–`0007`. Status: 0003–0006 Accepted; 0007 Accepted (Product Policy v1) — Gate G5 OPEN.

## B0.4 — EXPLAIN Baseline
**Deferred (conscious):** local dataset is not representative of the scale at which the query findings (F20–F23) bite; an EXPLAIN baseline on tiny local data would be misleading. To be captured on a representative dataset (staging with production-like volume) before Phase 8 index/trigram work.

---

## Phase 0 Status
| Batch | Status |
|---|---|
| B0.1 Verify DB role | ✅ Done — F2 confirmed (local) |
| B0.2 Bypass inventory | ✅ Done |
| B0.3 Decision ADRs | ✅ Done (0007 pending policy) |
| B0.4 EXPLAIN baseline | ◑ Deferred (representative data) |

**Open gate:** none — ADR 0007 accepted (Product Policy v1, 2026-07-10).
