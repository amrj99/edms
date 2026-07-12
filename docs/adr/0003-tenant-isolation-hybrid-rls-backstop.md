# ADR 0003 — Tenant Isolation: Application-Primary + RLS Fail-Closed Backstop (Hybrid)

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** Owner (Product/Engineering), Architecture Review (Phase 2 Remediation)
**Supersedes reality of:** ADR-06 (debt register — "no RLS / accepted risk")

---

## Context

The Phase 1 Architecture Review confirmed (evidence, Phase 0 B0.1):

- The application connects to PostgreSQL as role `edms`, which is **`rolsuper=t, rolbypassrls=t`** (superuser + BYPASSRLS). 13 RLS policies and 13 RLS-enabled tables exist (`rls-init.ts` ran), **but they are structurally inert** because the connecting role bypasses RLS entirely.
- Separately, RLS context is set via session-scoped `set_config(..., FALSE)` over a connection pool, and an unset variable is treated as **sysadmin bypass = sees all rows** → the design **fails open**.
- Tenant isolation is therefore enforced 100% at the application layer via ~950 manual `organizationId` filters across 42 route files, with **no working database backstop**.

This is the single highest-severity finding: the "RLS defence-in-depth" is illusory on two independent grounds (bypassing role + fail-open pooling).

## Decision

Adopt a **Hybrid** model:

1. **Application-layer scoping remains the PRIMARY isolation mechanism** — it is what the 33 backend tests actually exercise, and it is sound in design (`org-scope.ts`, `MULTI_TENANT_BOUNDARIES.md`).
2. **Add RLS as a real, fail-CLOSED backstop** — an unset/mismatched tenant context must yield **zero rows**, never "all rows".
3. This requires a **dedicated application DB role with `NOBYPASSRLS`** (the app must stop connecting as superuser), plus a **separate privileged role** for legitimate no-tenant-context work (see §Bypasses).
4. **Full request-scoped transactional RLS** (set_config transaction-scoped on every request) is **deferred to the Enterprise track**, not required for first customer. For the first customer, the minimum is: create the NOBYPASSRLS role + flip fail-open→fail-closed behind a feature flag.

### Alternatives considered
- **(A) Full transactional RLS now** — correct backstop but forces every request into a transaction (interacts badly with large file uploads holding pooled connections — see ADR sequencing) and touches ~950 sites. Too heavy for first customer.
- **(B) Remove RLS entirely + document honest app-only isolation** — simplest and honest, but leaves no backstop and is a hard SOC 2 blocker. Rejected as the end state, accepted as the interim posture during the pilot (documented accepted risk).
- **(C) Compile-time enforced query builder** — prevents forgotten filters at authoring time; recommended as a *complementary* long-term measure, not a substitute for the backstop.

## Bypasses (legitimate no-tenant-context paths — MUST keep working under fail-closed)
Inventoried in Phase 0 B0.2. These run with the **privileged role**, not the app role:
- Startup (pre-listen): `runIntegrityMigrations`, `initRlsPolicies`, `seedPlans`, `seedDefaultAdmin`, `backfillOrgConfig`, `resetModulesToPlan`.
- Cron (cross-tenant): `sendDueDateReminders`, `runScheduledSkills`, module-sync-scheduler.
- `system_owner` (sees all orgs; `orgOverride`).
- Migration runner (`migrate.ts`).

## Consequences
- **Migration:** create app + privileged DB roles; policies flip. Reversible (drop role/policy, flag off).
- **Deployment:** requires provisioning DB roles → a maintenance window for the cutover on production (Decision Gate: Production Deployment).
- **Must be proven before enabling:** unset context = 0 rows; bootstrap/cron/system_owner unaffected; cross-org negative tests green.
- **Dependency:** B2.1 (create NOBYPASSRLS role) MUST precede B2.2 (flip) — confirmed by B0.1 evidence (flipping fail-open is worthless while the role has BYPASSRLS).

## Verification (to close)
- Live: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='<app role>'` → both `f`.
- Isolation test: unset `app.current_org_id` → query returns 0 rows.
- Production confirmation of current `edms` role privileges requires DBA (no repo access to VPS).

---

## Revision 1 — 2026-07-10 (Post-Implementation Evidence — supersedes the phasing above)

**Status change:** the "flip fail-open→fail-closed behind a flag for first customer, defer transactional RLS" phasing (above) is **RETRACTED as unsafe**, on evidence.

### New evidence (from current code, not inference)
- `lib/db/src/index.ts`: a **single** connection pool, all consumers share it.
- `rls-init.ts:68-69`: the policy is **fail-open by construction** (empty/unset `app.current_org_id` ⇒ sees all rows).
- `middlewares/rls-context.ts:17-28` — the code authors' own comment states: `set_config(..., FALSE)` is **session-scoped over a pool**, so subsequent queries in a request may hit a different connection with a **stale/unset** value; therefore *"RLS is a defence-in-depth layer here, NOT the primary isolation mechanism"*, and only a *"per-request transaction wrapper (SET LOCAL inside BEGIN/COMMIT)"* removes the limitation.

### Consequence
Flipping the policy to **fail-closed over the pooled, session-scoped context is unsafe**: queries landing on a connection without the correct tenant context return only `organization_id IS NULL` rows → **functional breakage (random empty results)**, plus a residual stale-context risk. **Fail-closed RLS therefore DEPENDS ON a transaction-bound tenant context** — i.e. the very "transactional RLS" the original phasing tried to defer. The dependency `B2.1 → B2.2` as written is invalid.

### Decision (owner, 2026-07-10)
1. **Isolated Pilot:** application-level tenant isolation is the **actual** isolation mechanism. RLS is **NOT** claimed as an effective backstop; it is documented as inert (role `edms` is superuser+BYPASSRLS; even for a non-super role the current policy is fail-open). Accepted **only** if the first pilot is an **isolated / dedicated-per-customer deployment**, or at minimum does **not** co-locate multiple independent, untrusted tenants in one shared production DB.
2. **Real RLS backstop** = a **dedicated Workstream** (NOBYPASSRLS app role + transaction-bound tenant context + fail-closed policies). Its **gate is the HOSTING MODEL, not the subscription tier**: it is **required before Shared Multi-tenant Production / before running multiple independent tenants in one DB**. It is NOT "deferred to Enterprise".
3. **Do NOT choose now** among the tenant-context mechanisms — *request-wide transaction* / *AsyncLocalStorage + per-query hook* / *connection-checkout hook* / *repository abstraction*. They are **recorded as alternatives**; selecting one requires a **separate Architecture Review** before implementation.
4. **B2.1 and B2.2 are NOT executed now.** No new DB role is created without an approved connection plan.

### Minimum Safe Launch Baseline — split by hosting model
- **Isolated Pilot (dedicated/single-tenant deployment):** application-level isolation + strong cross-org negative tests (B2.7) + honest documentation that RLS is not an active backstop. **Sufficient.**
- **Shared Multi-tenant SaaS (multiple independent tenants, one DB):** **BLOCKED** until the Real-RLS Workstream ships (or an equivalent approved security control). Launching shared multi-tenant on application-only isolation is **not** sanctioned.
