-- Phase B · Step 2: Migrate stored 'free' values → 'expired' and update defaults
--
-- Pre-conditions (verified on dev 2026-05-06):
--   · All target columns are TEXT — no enum constraint on plan identifiers.
--   · subscription_status enum already has 'expired' (applied by 0004a).
--   · Exact row counts before migration:
--       organizations.subscription_tier = 'free'  → 5 rows
--       subscriptions.plan_id           = 'free'  → 1 row
--       subscriptions.status            = 'free'  → 0 rows  (existing row has status='active')
--       org_config.subscription_tier    = 'free'  → 5 rows
--       plans.plan_id                   = 'free'  → 1 row
--       ai_models.tier_minimum          = 'free'  → 0 rows  (table empty)
--
-- Idempotent: WHERE clauses ensure re-running is safe.

BEGIN;

-- ── 1. Plan identifier columns (all TEXT — no enum involved) ─────────────────

UPDATE organizations
SET    subscription_tier = 'expired',
       updated_at        = NOW()
WHERE  subscription_tier = 'free';

UPDATE subscriptions
SET    plan_id    = 'expired',
       updated_at = NOW()
WHERE  plan_id = 'free';

UPDATE org_config
SET    subscription_tier = 'expired',
       updated_at        = NOW()
WHERE  subscription_tier = 'free';

UPDATE plans
SET    plan_id    = 'expired',
       updated_at = NOW()
WHERE  plan_id = 'free';

-- ai_models: 0 rows in current data; included for completeness.
-- tier_minimum → 'trial' (not 'expired') — semantics: this field means
-- "minimum subscription level required to access this model", and 'trial'
-- is the correct floor (expired orgs should not have AI model access).
UPDATE ai_models
SET    tier_minimum = 'trial',
       updated_at   = NOW()
WHERE  tier_minimum = 'free';

-- ── 2. Subscription status (enum column; 'expired' committed by 0004a) ───────
-- Migrates any rows where status was set to 'free' (meaning: no Stripe
-- subscription, org is on the expired tier).
-- Current data: 0 rows qualify — safe no-op.
UPDATE subscriptions
SET    status     = 'expired',
       updated_at = NOW()
WHERE  status = 'free';

-- ── 3. Column defaults ────────────────────────────────────────────────────────

ALTER TABLE organizations  ALTER COLUMN subscription_tier SET DEFAULT 'expired';
ALTER TABLE subscriptions  ALTER COLUMN plan_id           SET DEFAULT 'expired';
ALTER TABLE subscriptions  ALTER COLUMN status            SET DEFAULT 'expired';
ALTER TABLE org_config     ALTER COLUMN subscription_tier SET DEFAULT 'expired';

-- ai_models.tier_minimum: default becomes 'trial' (most permissive access level
-- with an active subscription — expired orgs are blocked at middleware level).
ALTER TABLE ai_models      ALTER COLUMN tier_minimum      SET DEFAULT 'trial';

COMMIT;
