-- 0008_ai_governance — Add AI governance fields to org_config
--
-- Adds three columns that implement the organization-level AI master switch:
--
--   ai_enabled      BOOLEAN  — master AI gate; false = all AI inference blocked
--   ai_plan         TEXT     — 'disabled' | 'basic' | 'premium'
--   ai_monthly_limit INTEGER — monthly request cap; 0 = unlimited
--
-- IDEMPOTENCY:
--   All three statements use ADD COLUMN IF NOT EXISTS.
--   The UPDATE at the end is idempotent via the WHERE ai_enabled = false guard.
--
-- PRODUCTION SAFETY:
--   New columns default to false/'disabled'/0 — no existing org gains AI access.
--   Existing orgs with ai_credits_balance > 0 are opted-in to 'basic' AI because
--   they have already purchased credits and are actively using the feature.
--   This preserves current production behaviour without disruption.

ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_plan TEXT NOT NULL DEFAULT 'disabled';--> statement-breakpoint
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_monthly_limit INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint

-- Opt-in existing credit-holding organisations so they are not locked out.
-- Organizations with zero credits remain disabled (the default).
UPDATE org_config oc
SET    ai_enabled = true,
       ai_plan    = 'basic'
FROM   organizations o
WHERE  oc.organization_id = o.id
  AND  o.ai_credits_balance > 0
  AND  oc.ai_enabled = false;
