-- Phase 5 — Party Model Minimum
--
-- Adds two primitives:
--   1. projects.collaboration_mode — enables/disables cross-org party access per project
--   2. project_parties             — records which organizations are parties to a project
--
-- Design decisions:
--   - TEXT + CHECK (not pgEnum) for both role columns: new values added by updating CHECK
--     only, no ALTER TYPE ADD VALUE transaction complexity (MIGRATION_GOVERNANCE.md).
--   - DEFAULT 'org_only' on collaboration_mode: all existing projects are unaffected.
--   - Soft delete via removed_at / removed_by_id: preserves audit trail of who had access.
--   - UNIQUE (project_id, organization_id): one org → one role per project.
--     Re-adding after removal = UPDATE removed_at = NULL (not a new INSERT).
--   - Partial index on active parties: WHERE removed_at IS NULL — most access checks
--     filter by active parties only.
--   - See ADR-011 for why cross-org access uses a separate path from orgScopedWhere.
--
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS equivalent guards on all DDL).

-- ─── 1. Add collaboration_mode to projects ────────────────────────────────────

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "collaboration_mode" TEXT NOT NULL DEFAULT 'org_only';

ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "chk_collaboration_mode";

ALTER TABLE "projects"
  ADD CONSTRAINT "chk_collaboration_mode"
  CHECK ("collaboration_mode" IN ('org_only', 'parties'));

-- ─── 2. Create project_parties table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "project_parties" (
  "id"              serial PRIMARY KEY,
  "project_id"      integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "party_role"      text    NOT NULL,
  "added_by_id"     integer NOT NULL REFERENCES "users"("id"),
  "added_at"        timestamp NOT NULL DEFAULT now(),
  "removed_at"      timestamp,
  "removed_by_id"   integer REFERENCES "users"("id"),
  CONSTRAINT "uq_project_party" UNIQUE ("project_id", "organization_id"),
  CONSTRAINT "chk_party_role"   CHECK ("party_role" IN ('observer', 'contributor'))
);

-- ─── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_project_parties_project_id"
  ON "project_parties" ("project_id");

CREATE INDEX IF NOT EXISTS "idx_project_parties_org_id"
  ON "project_parties" ("organization_id");

-- Partial index: access checks always filter WHERE removed_at IS NULL.
CREATE INDEX IF NOT EXISTS "idx_project_parties_active"
  ON "project_parties" ("project_id", "organization_id")
  WHERE "removed_at" IS NULL;
