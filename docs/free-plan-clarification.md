# Free Plan Clarification Report
**Date:** 2026-05-06  
**Scope:** All uses of "free", "FREE_PLAN", "FREE_TIER", `isFree`, `plan === 'free'`, `visible_on_free`, `FREE_AI_CREDITS` across the entire codebase  
**Purpose:** Determine whether "free" is (a) expired trial state, (b) a Free Forever marketing plan, or (c) something else  
**Action required:** Read this report and make a business decision before any code changes proceed

---

## Executive Answer

**"free" is the post-trial expired state — it is NOT a Free Forever marketing plan.**

It is the tier an organisation lands on automatically when their 14-day trial expires without purchasing a subscription, or when a paid subscription is cancelled. It is a **data-preservation holding state**, not a product offering.

This is explicitly documented in the codebase:

> `lib/db/src/lib/trial.ts`, line 12–13:
> ```
> // Free is NOT a marketing tier — it is the state an org enters after a trial
> // expires without upgrading.
> ```

> `lib/db/src/lib/seed-plans.ts`, line 57–58:
> ```
> description: "Retained access after trial expiry. Upgrade to unlock all features."
> ```

---

## All references — categorised

### Category A — Subscription plan state identifier  
These references use `"free"` as the plan ID that an org is assigned when not on trial or a paid plan.

| File | Line | Code | Interpretation |
|---|---|---|---|
| `lib/trial.ts` | 14 | `FREE_PLAN_ID = "free"` | Named constant for the post-trial tier |
| `lib/plans.ts` | 21 | `id: "free"` | Plan catalog entry (data-preservation tier, not marketed) |
| `lib/plans.ts` | 157 | `tier ?? "free"` | Default fallback when tier is null |
| `lib/seed-plans.ts` | 56–76 | `planId: "free"` | Plan catalog DB row — "Retained access after trial expiry" |
| `lib/trial-downgrade-scheduler.ts` | 14 | `org.subscription_tier = "free"` | Set by scheduler when trial expires |
| `lib/trial-downgrade-scheduler.ts` | 76, 131 | `.set({ subscriptionTier: "free" })` | DB write on trial expiry |
| `routes/billing.ts` | 452–469 | `planId: "free"`, `subscriptionTier: "free"` | Set by Stripe webhook on subscription cancellation |
| `routes/admin.ts` | 237–238 | `billingPlan = sub?.planId ?? "free"` | Admin display — fallback label when no subscription row |
| `routes/admin.ts` | 816 | `COALESCE(plan_id, subscription_tier, 'free')` | SQL fallback for admin org list |
| `routes/admin.ts` | 828 | `validPlanIds = ["free", ...PLANS]` | Validates admin plan-change input |
| `routes/projects.ts` | 153 | `PLANS.find(p => p.id === subscription_tier ?? "free")` | Project creation limit lookup |
| `lib/plan-service.ts` | 138–177 | Returns `"free"` on error or no subscription | Safe default — never throws |
| `lib/module-sync-service.ts` | 131–156 | `planId = "free"` default | Module flag resolver fallback |
| `lib/reset-modules-to-plan.ts` | 73 | `"free"` | Module flag reset fallback |
| `lib/db/schema/organizations.ts` | 20 | `.default("free")` | DB column default for subscription_tier |
| `lib/db/schema/subscriptions.ts` | 5, 18, 22 | `"free"` in enum + defaults | Subscription status and plan_id defaults |

**Conclusion for Category A:** All consistent. `"free"` = post-trial or cancelled state. No reference here implies a Free Forever marketing product.

---

### Category B — AI provider cost tier (DIFFERENT CONCEPT — same word)

⚠️ **This is a naming collision that creates confusion.** In the AI routing system, `"free"` describes the **cost tier of an AI provider** (e.g. Cloudflare, Groq = free-cost providers vs OpenRouter = paid-cost provider). This is completely unrelated to the subscription plan tier.

| File | Line | Code | Interpretation |
|---|---|---|---|
| `lib/ai-core.ts` | 23–27 | Provider comments: `// free primary`, `// free` | Cost tier of the provider, not the subscription plan |
| `lib/ai-core.ts` | 510 | `free: ["cloudflare"]` in `PLAN_FREE_PROVIDERS` | Maps subscription tier → free provider list |
| `lib/ai-core.ts` | 527–528 | `tier: "premium" \| "free"` in resolution result | AI execution tier (which provider was used), not plan |
| `lib/ai-core.ts` | 561 | `"credits_free"` reason | Credits-based routing chose the free-cost provider |
| `lib/ai-core.ts` | 684–695 | `resolveFreeProvider()` | Resolves which free-cost provider to use |
| `routes/ai.ts` | 636–686 | `freeProv`, `freeModel`, `tier: "free" | "premium"` | Which provider was chosen for this call |
| `routes/ai.ts` | 722–751 | `"[AI] premium failed → fallback to free"` | Provider fallback log, not plan change |
| `lib/ai-core.ts` | 931 | `FREE_TIER_PROVIDERS.has(providerKey)` | Set of providers considered "free cost" |

**Conclusion for Category B:** These references use `"free"` to mean "zero-cost AI provider" and are not about the subscription plan. The word overlap is a readability risk but there is no functional confusion in the code — the two concepts never intersect in the same variable.

---

### Category C — Plan feature limits and quota constants

| File | Line | Code | Interpretation |
|---|---|---|---|
| `lib/trial.ts` | 15–19 | `FREE_MAX_USERS`, `FREE_STORAGE_MB`, `FREE_AI_CREDITS = 0` | Quota constants for the post-trial state |
| `lib/plans.ts` | 170 | `free: { dashboard: true, deliverables: false, ... }` | Module flags for post-trial orgs |
| `routes/migrations.ts` | 20 | `free: 0` in PLAN_LIMITS | Migration wizard disabled for free tier |
| `middlewares/tenant-rate-limit.ts` | 10, 64, 117 | `free: 300` RPM | Rate limit for free-tier orgs |

**Conclusion for Category C:** All consistent with "free = post-trial holding state." The zero AI credits (`FREE_AI_CREDITS = 0`) and disabled module flags confirm it is a restricted state, not a featured product.

---

### Category D — Columns for data-preservation logic

| File | Line | Code | Interpretation |
|---|---|---|---|
| `lib/db/schema/projects.ts` | 24 | `visible_on_free boolean DEFAULT true` | Controls which project is visible when an org is on free tier |
| `lib/db/schema/users.ts` (implied) | — | `is_read_only_override boolean DEFAULT false` | Marks users who lose write access after trial expiry |
| `trial-downgrade-scheduler.ts` | 116 | `visibleOnFree: true/false` | Written during trial → free downgrade |

**Conclusion for Category D:** These columns exist specifically to implement the trial-expiry downgrade rules (preserve data, restrict access). They confirm "free" is the degraded post-trial state.

---

### Category E — Frontend UI

| File | Line | Code | Interpretation |
|---|---|---|---|
| `components/TrialExpiredBanner.tsx` | 28 | `if (status.tier !== "free") return null` | Banner only shows for post-trial orgs |
| `pages/billing.tsx` | 645 | "Your free trial has ended." | Copy — refers to trial, not a Free plan |
| `pages/billing.tsx` | 658 | "days left on your free trial" | Trial countdown copy |
| `pages/admin.tsx` | 330, 637 | `selectedPlan = "free"`, `<SelectItem value="free">Free</SelectItem>` | Admin can manually assign "free" tier to any org |
| `pages/register.tsx` | 41, 213 | "14-day free trial" | Marketing copy — refers to trial |

**Conclusion for Category E:** The admin UI (`admin.tsx`) explicitly shows "Free" as a selectable plan option. This means an admin can manually place any org on "free" — not just via trial expiry or cancellation. This is an intentional admin capability, not an accident.

---

### Category F — Credit grants (important: two overlapping grants)

| File | Line | Code | Amount | Trigger |
|---|---|---|---|---|
| `lib/ai-credits.ts` | 50 | `INITIAL_FREE_CREDITS = 1_000` | 1,000 | Every new org created |
| `routes/organizations.ts` | 124 | `grantCredits(org.id, INITIAL_FREE_CREDITS, "grant", { reason: "initial_free_grant" })` | 1,000 | Org creation via `/organizations` endpoint |
| `routes/auth.ts` | 562 | `grantCredits(org.id, TRIAL_AI_CREDITS, "grant", { reason: "trial_signup" })` | 1,000 | Trial signup via `/auth/register` |

⚠️ **Finding: trial orgs may receive 2,000 credits total, not 1,000.**

When a user registers (creating an org via `/auth/register`), the code:
1. Calls the organizations route which grants `INITIAL_FREE_CREDITS` (1,000)
2. Then immediately grants `TRIAL_AI_CREDITS` (1,000) in the same handler

Whether both grants fire depends on whether org creation goes through the organizations route internally during registration. This needs verification.

If both grants fire: trial orgs start with 2,000 credits.  
If only one fires: trial orgs start with 1,000 credits.  

The constant names add to the confusion: `INITIAL_FREE_CREDITS` sounds like it is for the free plan, but it is granted to all new orgs including trial.

---

## Decision required

Please choose one of the following positions and confirm before any code changes proceed:

### Position 1 — Keep "free" as post-trial state only (current design)
No changes needed to the definition. The `requireAiPlan` middleware (previously proposed) is implemented to block AI access for `planId === "free"` orgs. The admin UI "Free" option remains for manual assignment.

### Position 2 — Rename "free" to "expired" to eliminate ambiguity
The plan ID `"free"` is renamed to `"expired"` (or `"restricted"`) throughout the codebase. This eliminates the collision with the AI provider `"free"` cost tier naming. Requires a DB migration (`UPDATE organizations SET subscription_tier = 'expired' WHERE subscription_tier = 'free'`), code changes across ~30 files, and a new migration file.

### Position 3 — Add a genuine Free Forever plan alongside the current "free" expired state
A new plan ID `"free_forever"` is introduced as a real marketing tier with defined limits. The existing `"free"` plan remains as the expired state. This requires a new plan definition, new module flags, and new UI.

---

## Files containing "free" references — full index

```
BACKEND — CORE PLAN LOGIC
  artifacts/api-server/src/lib/trial.ts            — FREE_PLAN_ID, FREE_* constants
  artifacts/api-server/src/lib/plans.ts            — plan catalog, module flags
  artifacts/api-server/src/lib/plan-service.ts     — resolver, defaults to "free" on error
  artifacts/api-server/src/lib/seed-plans.ts       — DB plan seed data
  artifacts/api-server/src/lib/module-sync-service.ts — module flag sync
  artifacts/api-server/src/lib/reset-modules-to-plan.ts — module flag reset
  artifacts/api-server/src/lib/trial-downgrade-scheduler.ts — writes "free" tier on expiry

BACKEND — ROUTES
  artifacts/api-server/src/routes/auth.ts          — trial signup credit grant
  artifacts/api-server/src/routes/organizations.ts — initial credit grant
  artifacts/api-server/src/routes/billing.ts       — Stripe webhook sets "free" on cancel
  artifacts/api-server/src/routes/admin.ts         — admin plan assignment
  artifacts/api-server/src/routes/projects.ts      — project limit lookup
  artifacts/api-server/src/routes/migrations.ts    — wizard disabled on free tier
  artifacts/api-server/src/routes/ai.ts            — AI provider tier (different concept)

BACKEND — AI SYSTEM (provider cost tier, NOT subscription plan)
  artifacts/api-server/src/lib/ai-core.ts          — free-cost provider routing
  artifacts/api-server/src/lib/ai-credits.ts       — INITIAL_FREE_CREDITS constant

BACKEND — MIDDLEWARE
  artifacts/api-server/src/middlewares/tenant-rate-limit.ts — RPM limit for free tier

DATABASE SCHEMA
  lib/db/src/schema/organizations.ts    — subscription_tier default "free"
  lib/db/src/schema/projects.ts         — visible_on_free column
  lib/db/src/schema/subscriptions.ts    — planId default "free"
  lib/db/src/schema/ai.ts               — tier_minimum default "free"
  lib/db/src/schema/config.ts           — org_config.subscription_tier default "free"

FRONTEND
  artifacts/edms/src/components/TrialExpiredBanner.tsx  — tier === "free" check
  artifacts/edms/src/components/AICommandAssistant.tsx  — tier type definition
  artifacts/edms/src/pages/billing.tsx                  — "free trial" copy (trial, not plan)
  artifacts/edms/src/pages/admin.tsx                    — admin Free plan option
  artifacts/edms/src/pages/register.tsx                 — "14-day free trial" copy
```

---

## Note on production pricing page alignment

Your pricing page shows: **Starter / Basic / Professional / Enterprise + 14-day Trial**.

The codebase `"free"` plan is **not shown on the pricing page** — consistent with it being a post-cancellation/post-trial state rather than an advertised product. No change needed to the pricing page regardless of which decision above is chosen.
