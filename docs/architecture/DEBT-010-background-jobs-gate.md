# DEBT-010 — Background-jobs / edms_app Gate (read-only inventory + classification)

**Status:** READ-ONLY inventory + classification. No code changed yet. Stop-and-present items below
require owner decisions BEFORE any transformation. Isolated env only — no Production, no cutover, no
`DATABASE_URL` change, no push.

## How each background path executes today
Every timer/`setImmediate`/detached path runs with **no request ALS** (or deliberately exits it), so
bare `db` resolves to the **pool with no RLS context** (`app.current_org_id=''`,
`is_system_owner='false'`, `current_user_id=''`). Under superuser today RLS is inert, so this "works";
under the non-superuser `edms_app` role, RLS reads on the 13 tables return **0 rows** and writes are
**blocked**. That is the gap this gate closes.

The prior 6-item list was **incomplete**. Full inventory (10 paths):

## Inventory

| # | Path (entry point) | Trigger | Scope | RLS-13 tables | orgId | identity | ext I/O | context today |
|---|---|---|---|---|---|---|---|---|
| 1a | skill cron `runScheduledSkills`→`executeSkill` (bootstrap.ts:94; skill-engine.ts:100) | timer hourly | global fetch → per-skill(org) | documents, projects, correspondence, tasks, **notifications(W)** | yes (WHERE) | system (triggeredById null); notifies humans by data | email (Resend), interleaved | pool, no RLS |
| 1b | reminders `sendDueDateReminders` (bootstrap.ts:107; reminder-job.ts:15) | timer, once/day | **fully global, NO org loop** | tasks, projects, **notifications(W)** | ignored | system; notifies humans | email, interleaved | pool, no RLS |
| 2 | module-sync `syncAllOrgModules` (module-sync-scheduler.ts:77; service:250) | timer 30 min | per-org loop | **none** (org_config/subscriptions/overrides) | yes | system | none | pool (fine — non-RLS) |
| 3 | notification scheduler `processBatch` (scheduler.ts:252) | timer 5 min | global queue drain | **none** (scheduled_notifications, notification_logs, users) | per-job | system → human email | email (Resend) | pool + `notificationDb` |
| 4 | trial-downgrade `processExpiredTrials`→`downgradeOrg` (trial-downgrade-scheduler.ts:169) | timer 5 min | per-org loop | **projects(R/W)** | yes | system, **audit attributed to a human (keepUser.id)** | none | pool, no RLS |
| 5 | auth login-attempt cleanup (auth.ts:73 setInterval) | timer 30 min | n/a | none | no | none | none | in-memory only |
| 6 | classification `dispatchClassificationBackground`/`classifyDetached`→`classifyItem` (classification-events.ts) | request (detached) | per-org | **none** (ai_logs/org_config/system_settings) | optional | service (userId log-only) | AI | `runDetachedFromRequest` (pool) |
| 7 | skill events `dispatchSkillEventBackground`/`executeSkillBackground` (skill-events.ts) | request (detached) | per-org | documents, correspondence, tasks, projects, **notifications(W)** | yes | system; notifies humans by data | email | `runDetachedFromRequest` (pool) |
| 8 | shadow-plan middleware (shadow-plan-middleware.ts:89 setImmediate) | every auth req | per-org | **none** (plans/subscriptions/org_config, read-only) | yes | none | none | not detached, bare db (read-only) |
| 9 | access-resolver `shadowEvaluate*` (access-resolver.ts) | request (void + awaited) | per-user/doc | **transmittals(R)**; writes `access_shadow_log`(non-13) | optional | real user | none | bare db; inherits caller tx when awaited |
| 10 | migrations `analyze`/`execute` setImmediate (migrations.ts:192,444) | request (setImmediate) | per-org/job | **documents(R/W), document_revisions(W)** | yes | `job.createdById` (human, captured at create) | AI (analyze) | not detached, bare db (pool) |
| 11 | admin reindex `runUnscoped(reindexAll)` (admin.ts:701; search-service.ts:100) | admin request | **global/cross-tenant** | **documents(R)** | no | none (platform) | Elasticsearch | `runUnscoped` (pool) |

## Classification (A / B / C)

### A — tenant job (per-org `runInTenantTx`, short DB unit, external I/O OUTSIDE the tx)
- **1a skill cron**, **7 skill events** — per-org: `withSystemTenantTx(skill.organizationId)` around the DB
  read+write; email OUTSIDE. notifications/tasks/projects writes pass their org-level WITH CHECK with org
  context alone (no human user needed — recipients are data columns).
- **1b reminders** — must become **per-org** (loop org ids, one `withSystemTenantTx(orgId)` per org)
  instead of the current global scans. (Decision R1 below.)
- **4 trial-downgrade** — already per-org loop → wrap each org in `withSystemTenantTx(orgId)`; the
  per-org multi-statement sequence becomes atomic. (Decision R2 on audit attribution.)
- **10 migrations background** — per-job/per-org `withSystemTenantTx(job.organizationId)` for the DB side,
  AI I/O outside; tied to the deferred `/migrations` route. (Decision R3.)
- **9 access-resolver** — when AWAITED it already inherits the caller's tenant tx (correct under
  edms_app). The `void` fire-and-forget shadow-log writes may fail-closed (swallowed) — shadow-only,
  best-effort; acceptable, but noted. No new context needed.

### B — legitimate platform-wide operation (explicit, named, LIMITED system-owner context)
- **11 admin reindex** — genuinely cross-tenant read of `documents`. Refactor `runUnscoped(reindexAll)`
  → **`withSystemContext(reindexAll)`** = `runInTenantTx({ orgId: null, isSystemOwner: true, userId: null })`
  so RLS admits all tenants under the explicit system flag; ES push stays OUTSIDE the tx. This is the
  ONLY global bypass; it stays **allowlisted + named** (replaces the one `runUnscoped` allowlist entry).

### C — infrastructure / non-RLS (do NOT grant system context)
- **2 module-sync** (org_config etc.), **3 notification scheduler** (scheduled_notifications +
  notification_logs via the pool-backed `notificationDb` — email only, no in-app RLS table), **5 auth
  cleanup** (in-memory), **6 classification** (ai_logs/org_config/system_settings), **8 shadow-plan**
  (plans/subscriptions/org_config, read-only). These touch only non-RLS tables (or none) → correct on
  the pool under `edms_app` (which holds the needed non-RLS grants). No system context; no bypass.

## New context primitives required (no general bypass; no `runUnscoped`; no general `poolDb`)
Two named, minimal helpers (in `@workspace/db`, mirroring `runInTenantTx`):
- **`withSystemTenantTx(orgId, fn)`** = `runInTenantTx({ orgId, isSystemOwner:false, userId:null }, fn)`
  — a per-org system-actor unit-of-work for Category A jobs. No human `current_user_id` (`userId:null`).
- **`withSystemContext(fn)`** = `runInTenantTx({ orgId:null, isSystemOwner:true, userId:null }, fn)` —
  the ONLY platform-wide escape, for Category B (reindex). Named, allowlisted, and static-guarded like
  `runUnscoped` is today.
Neither impersonates a human user. `current_user_id` stays empty for all system-generated work; the
per-user RLS predicates (notifications read) are never exercised by background writers.

## 🛑 STOP-AND-PRESENT — owner decisions required before transformation

**S-1 (service identity model).** Adopt `withSystemTenantTx(orgId)` (org-scoped, `is_system_owner=false`,
`current_user_id=NULL`) for Category-A jobs and `withSystemContext()` (`is_system_owner=true`) for the
single Category-B op (reindex)? No job will set `current_user_id` to a human. **Decision needed** because
this introduces a named system context (constraint #3).

**S-2 (trial-downgrade audit attribution).** Today `downgradeOrg` writes the audit row with
`userId: keepUser.id` — attributing a SYSTEM action to a real human. Options: (a) write the audit with a
**system principal** (`userId: null` + `actorRole:'system'`) — recommended, stops human attribution of
system acts; (b) keep attributing to the kept admin. **Decision needed** (semantics change).

**S-3 (reminders restructure).** Path 1b currently does unscoped cross-tenant scans with no org loop.
Convert to **per-org** (Category A: enumerate orgs, per-org `withSystemTenantTx`) — recommended, avoids a
global read of RLS tables — vs a single `withSystemContext` global pass (Category B). Per-org changes the
job's shape (a loop) but not its outcomes. **Decision needed** (structural).

**S-4 (migrations background).** Path 10 is tied to the deferred `/migrations` route. Transform its
`setImmediate` blocks now (Category A per-job) as part of this gate, or keep `/migrations` deferred (route
bare) until a dedicated pass? **Decision needed** (scope).

No transformation, no new helpers, and no policy/grant changes will be written until S-1…S-4 are decided.

## After approval — remaining gate steps (not started)
1. Implement A/B/C transforms + the two named helpers; static-guard `withSystemContext` like `runUnscoped`.
2. Concurrent-A/B + pool-reuse tests for the background paths (context does not leak across orgs).
3. **Application-under-edms_app Gate:** run the API/test app so the RUNTIME connection itself is
   `edms_app` (migrations/setup stay on a separate owner/migrator role); prove `edms_app` owns no table
   and lacks BYPASSRLS/SUPERUSER/CREATE; prove only the required GRANTs; run typecheck + build + FULL
   regression + membership-RLS matrix + missing-context fail-closed + background jobs under `edms_app`.
   Any RLS-broken test → classify (real authz blocked / missing context / missing GRANT / test relies on
   superuser) and PRESENT before any policy widening.
4. **DEBT-010 Pre-Production Cutover Gate** deliverable: final posture, edms_app test results, all
   SECURITY DEFINER functions, all system/platform bypasses, background-jobs context list, GRANT matrix,
   migration/rollback plan, exact cutover order. Then STOP for a new approval + backup.

DEBT-013 and DEBT-009 remain separate.
