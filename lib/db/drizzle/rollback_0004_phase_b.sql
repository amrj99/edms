-- ROLLBACK: Phase B migration (0004a + 0004b + 0004c)
--
-- Run this ONLY if Phase B must be reverted.
-- The normalizer (Phase A) handles 'free' on reads, so the application
-- continues working during rollback without a code redeploy.
--
-- What this does NOT undo:
--   · The 'expired' enum value added to subscription_status.
--     ALTER TYPE DROP VALUE is available in Postgres 16+ but only after
--     zero rows reference the value — verify with:
--       SELECT COUNT(*) FROM subscriptions WHERE status = 'expired';
--     If 0, then: ALTER TYPE subscription_status DROP VALUE 'expired';
--
-- Sequence: restore data first, then restore defaults.

BEGIN;

-- ── 1. Restore plan identifier data ──────────────────────────────────────────

UPDATE organizations
SET    subscription_tier = 'free',
       updated_at        = NOW()
WHERE  subscription_tier = 'expired';

UPDATE subscriptions
SET    plan_id    = 'free',
       updated_at = NOW()
WHERE  plan_id = 'expired';

UPDATE subscriptions
SET    status     = 'free',
       updated_at = NOW()
WHERE  status = 'expired';

UPDATE org_config
SET    subscription_tier = 'free',
       updated_at        = NOW()
WHERE  subscription_tier = 'expired';

UPDATE plans
SET    plan_id    = 'free',
       updated_at = NOW()
WHERE  plan_id = 'expired';

UPDATE ai_models
SET    tier_minimum = 'free',
       updated_at   = NOW()
WHERE  tier_minimum = 'trial';

-- ── 2. Restore plans catalog display metadata ─────────────────────────────────

UPDATE plans
SET
  name        = 'Free',
  description = 'Retained access after trial expiry. Upgrade to unlock all features.',
  updated_at  = NOW()
WHERE plan_id = 'free';

-- ── 3. Restore column defaults ────────────────────────────────────────────────

ALTER TABLE organizations  ALTER COLUMN subscription_tier SET DEFAULT 'free';
ALTER TABLE subscriptions  ALTER COLUMN plan_id           SET DEFAULT 'free';
ALTER TABLE subscriptions  ALTER COLUMN status            SET DEFAULT 'free';
ALTER TABLE org_config     ALTER COLUMN subscription_tier SET DEFAULT 'free';
ALTER TABLE ai_models      ALTER COLUMN tier_minimum      SET DEFAULT 'free';

COMMIT;

-- ── 4. Optional: remove 'expired' enum value (Postgres 16+ only) ─────────────
-- Uncomment ONLY after confirming zero rows reference 'expired':
--   SELECT COUNT(*) FROM subscriptions WHERE status = 'expired';
--
-- ALTER TYPE subscription_status DROP VALUE 'expired';
