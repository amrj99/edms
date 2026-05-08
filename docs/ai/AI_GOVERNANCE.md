# AI Governance Architecture

**Status:** Implemented (migration 0008_ai_governance, May 2026)

## Overview

AI in ArcScale EDMS is an **organisation-controlled optional module**. Every
organisation starts with AI disabled. An administrator or system owner must
explicitly enable it before any AI inference endpoint becomes reachable.

Enforcement is **backend-first**: the frontend hides AI UI elements when AI is
disabled, but this is UX convenience only. All access control is enforced at
the API layer and cannot be bypassed by a client.

---

## Data Model

Three new columns were added to `org_config` by migration `0008_ai_governance`:

| Column | Type | Default | Description |
|---|---|---|---|
| `ai_enabled` | `boolean NOT NULL` | `false` | Master AI switch. All inference endpoints are blocked when false. |
| `ai_plan` | `text NOT NULL` | `'disabled'` | Plan tier: `disabled` \| `basic` \| `premium` |
| `ai_monthly_limit` | `integer NOT NULL` | `0` | Monthly request cap per org. 0 = unlimited (credit-governed only). |

### Existing organisations at migration time
Organisations with `ai_credits_balance > 0` were automatically opted in to
`ai_enabled = true, ai_plan = 'basic'` because they had already purchased
credits and were actively using AI. Organisations with zero credits remain
disabled by default.

---

## Enforcement Architecture

### Backend gate: `require-ai-enabled` middleware

Located at `artifacts/api-server/src/middlewares/require-ai-enabled.ts`.

Applied as the outermost middleware on the `/api/ai` router in `routes/index.ts`:

```
router.use("/ai", requireAiEnabled(), aiRouter);
```

**Bypass rules (in order):**
1. Path starts with `/settings` → pass through (admins need to configure AI to enable it)
2. No `orgId` (system_owner or unauthenticated) → pass through (requireAuth inside handles 401)
3. `org_config.ai_enabled = false` → `403 AI_DISABLED`
4. `org_config` row missing → `403 config_missing`
5. DB error → `503 service_unavailable`

### Layered enforcement stack (AI inference request path)

```
requireAiEnabled()          ← org-level master switch (NEW)
  └─ requireAuth            ← JWT validation
       └─ isModuleEnabled() ← per-module AI toggle (documents, correspondence, …)
            └─ getCreditsBalance / deductCredits  ← credit enforcement
```

All layers must pass for an AI call to succeed.

---

## Admin Control API

### `GET /api/config/ai-governance`
Returns the current AI governance state for the caller's organisation.

**Roles:** `admin`, `system_owner`

**Response:**
```json
{
  "aiEnabled": false,
  "aiPlan": "disabled",
  "aiMonthlyLimit": 0,
  "aiDailyLimit": 0,
  "aiMonthlyTokenLimit": 0,
  "aiPrivacyMode": false
}
```

### `PUT /api/config/ai-governance`
Updates AI governance settings.

**Roles:** `admin`, `system_owner`

**Body (all fields optional):**
```json
{
  "aiEnabled": true,
  "aiPlan": "basic",
  "aiMonthlyLimit": 500,
  "aiPrivacyMode": false
}
```

**Plan / enabled sync rules:**
- Setting `aiPlan = "disabled"` automatically sets `aiEnabled = false`.
- Setting `aiPlan = "basic"` or `"premium"` automatically sets `aiEnabled = true`
  (unless `aiEnabled` is explicitly provided in the same request).

---

## Frontend Gating

The `useAiAccess` hook (`artifacts/edms/src/hooks/use-ai-access.ts`) reads
`aiEnabled`, `aiPlan`, and `aiMonthlyLimit` from `/api/config`.

**What is gated by `aiEnabled`:**
- AI Insights sidebar menu item
- AI Command Assistant button in the top header
- (Individual feature components gate themselves via `isModuleEnabled` and credit checks)

**What is always visible to admins:**
- AI Settings page link in the admin nav (admins always need access to configure AI)

---

## Enabling AI for an Organisation

**Via API:**
```bash
curl -X PUT /api/config/ai-governance \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"aiPlan": "basic"}'
```

**Via Admin UI:**
Navigate to Admin → AI Settings and enable the AI toggle.

---

## Migration Reference

**File:** `lib/db/drizzle/0008_ai_governance.sql`
**Journal idx:** 8
**Timestamp:** 1778248222453
**Safe to re-run:** Yes (all statements are idempotent via `ADD COLUMN IF NOT EXISTS`)
