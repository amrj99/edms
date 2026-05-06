-- Phase B · Step 3: Update plans catalog display metadata
--
-- The plans table row with plan_id='expired' (migrated from 'free' in 0004b)
-- still has display fields that say "Free".  This migration updates them to
-- reflect the new canonical name.
--
-- Affects:  plans table only (display metadata, no structural changes).
-- Data:     1 row updated.

BEGIN;

UPDATE plans
SET
  name        = 'Expired (Read-only)',
  description = 'Access after trial expiry. Read-only until upgraded.',
  updated_at  = NOW()
WHERE plan_id = 'expired';

COMMIT;
