# ADR 0001 — Rename Plan Tier `"free"` to `"expired"`

**Status:** Accepted  
**Date:** 2026-05-06  
**Deciders:** Product, Engineering

---

## Context

The subscription system uses the string `"free"` as the plan identifier for organisations whose 14-day trial has ended and who have not subscribed to a paid plan. This label is misleading in two ways:

1. It implies a "Free Forever" tier, which ArcScale does not offer.
2. It conflicts with developer intuition — `"free"` usually means "no cost, ongoing access" not "trial expired, read-only".

The post-trial state is correctly understood as **expired**: the organisation retains read-only access but cannot use full features without upgrading.

## Decision

Rename the plan tier identifier `"free"` → `"expired"` across the codebase and database.

A 3-phase migration was executed to do this safely:

### Phase A — Code normalizer (no DB changes)
- Created `lib/plan-normalizer.ts` with `normalizePlanId()`, `isExpiredPlan()`, `hasActiveSubscription()`.
- Both `"free"` (legacy, in DB) and `"expired"` (new canonical) map to `"expired"` in memory.
- All read paths and comparisons updated to use the normalizer.
- DB still stores `"free"`. Zero data changed. Zero risk.

### Phase B — Data migration + write-site cleanup
Executed in the same session since production has no real customers.

**Migrations (in order):**
- `0004a`: `ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired'` — adds `'expired'` to the Postgres enum. Separate transaction required by Postgres before the value can be used in DML.
- `0004b`: Migrates all stored `'free'` values → `'expired'` across `organizations`, `subscriptions`, `org_config`, `plans`, `ai_models`. Updates all column defaults.
- `0004c`: Updates the `plans` catalog display metadata (name, description) for the `expired` row.

**Code changes (Option A — full):**
- `trial-downgrade-scheduler.ts`: Writes `subscriptionTier = "expired"` instead of `"free"` going forward.
- `billing.ts`: All Stripe webhook handlers and fallbacks write `"expired"` not `"free"`.
- `documents.ts`: Upload gate uses `isExpiredPlan()` instead of `=== "free"`.
- `admin.ts`: `validPlanIds` accepts `"expired"`, rejects bare `"free"`.
- `seed-plans.ts` + `plans.ts`: Catalog entry updated to `id: "expired"`.

### Phase C — Enum cleanup (deferred)
Remove `"free"` from the `subscription_status` enum entirely. Deferred indefinitely — requires all downstream code and monitoring tools to be confirmed free of `"free"` references.

## Consequences

**Positive:**
- Plan intent is self-documenting in code and DB queries.
- No ambiguity between "free tier" and "expired trial" in logs and analytics.
- Simplifies future "Free Forever" plan addition (no naming collision).

**Negative / Risks:**
- Any external system (Stripe metadata, scripts, export tools) hardcoding `"free"` as a plan value will silently mismatch until updated. The normalizer catches these on read.
- The `"free"` enum value remains in `subscription_status` until Phase C.

## Notes on column types

All plan identifier columns (`subscription_tier`, `plan_id`, `tier_minimum`) are **`text`** — not enum-typed. The `subscription_status` enum applies only to `subscriptions.status`. This was verified before Phase B execution.

## AI tier naming

The AI provider cost tier also uses the string `"free"` (in `ai-core.ts`, `routes/ai.ts`, `AICommandAssistant.tsx`). This is a **different concept** — it refers to zero-cost AI providers, not the subscription plan. These strings were intentionally left unchanged.
