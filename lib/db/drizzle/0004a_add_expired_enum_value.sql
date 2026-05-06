-- Phase B · Step 1: Add 'expired' to the subscription_status enum
--
-- Must be committed in its own transaction before Step 2 (0004b) can
-- reference the new value.  Postgres requires the ADD VALUE to be visible
-- (i.e., committed) before 'expired' can appear in any UPDATE or DEFAULT.
--
-- Safe to run more than once — IF NOT EXISTS is a no-op when already present.
--
-- Affected enum:  subscription_status
-- New value:      'expired'  (placed after the existing 'free' value)

ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired';
