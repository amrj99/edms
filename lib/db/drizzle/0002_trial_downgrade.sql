-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_trial_downgrade
-- Adds two columns for the trial auto-downgrade feature (Phase 4).
-- Both use IF NOT EXISTS — safe to re-run on existing databases.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_read_only_override boolean NOT NULL DEFAULT false;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visible_on_free boolean NOT NULL DEFAULT true;
