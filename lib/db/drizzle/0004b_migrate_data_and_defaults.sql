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
--
-- PRODUCTION NOTE: VPS databases provisioned via migrate_production.sql before May 2026
-- do not have the ai_models table (it was added to 0000_init.sql after migrate_production.sql
-- was last written, and 0001_incremental.sql did not include it). The CREATE TABLE IF NOT EXISTS
-- block below is a safe no-op on any database that already has the table, and creates it
-- correctly on any database that does not.

-- ── 0. Ensure ai_models table exists before any DML touches it ────────────────
-- Must run outside the transaction block: Drizzle's runner treats the file as
-- a single statement batch; DDL here auto-commits before BEGIN is reached.
CREATE TABLE IF NOT EXISTS "ai_models" (
    "id"           serial      PRIMARY KEY NOT NULL,
    "provider"     text        NOT NULL,
    "model_id"     text        NOT NULL,
    "display_name" text        NOT NULL,
    "tier_minimum" text        NOT NULL DEFAULT 'free',
    "is_active"    boolean     NOT NULL DEFAULT true,
    "created_at"   timestamp   NOT NULL DEFAULT now(),
    "updated_at"   timestamp   NOT NULL DEFAULT now(),
    CONSTRAINT "ai_models_provider_model" UNIQUE ("provider", "model_id")
);
CREATE INDEX IF NOT EXISTS "idx_ai_models_provider" ON "ai_models" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "idx_ai_models_active"   ON "ai_models" USING btree ("is_active");

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
