-- Migration 0011: Add must_change_password column to users table
--
-- Purpose: Support user onboarding flow where admin-created users
--          must set their own password on first login.
--
-- Safe for production:
--   DEFAULT false ensures all 17 existing users are unaffected.
--   No data backfill required.

ALTER TABLE "users"
  ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false;
