-- Phase B · Step 1: Add 'expired' to the subscription_status enum
--
-- TRANSACTION NOTE:
--   drizzle-orm's migrate() wraps all pending migrations in a single outer
--   BEGIN/COMMIT.  migrate.ts::ensureEnumValues() pre-commits this value
--   via pool.query() in autocommit mode BEFORE migrate() opens that outer
--   transaction, so this migration is a guaranteed no-op by the time it runs.
--
-- IDEMPOTENCY:
--   The DO-block EXCEPTION handler catches error 42710 (duplicate_object)
--   so this migration is safe regardless of the database state — whether the
--   value was pre-committed by ensureEnumValues(), added by a previous manual
--   run of migrate_production.sql, or is being applied for the first time on
--   a fresh database.
--
-- Affected enum:  subscription_status
-- New value:      'expired'

DO $$
BEGIN
    ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired';
EXCEPTION
    WHEN duplicate_object THEN
        -- enum label 'expired' already exists — nothing to do.
        NULL;
END;
$$;
