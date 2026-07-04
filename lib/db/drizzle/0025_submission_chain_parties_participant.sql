-- Phase 3 — Submittal Lifecycle: participant-based party routing
--
-- submission_chain_allowed_parties previously identified parties by org_id.
-- That model fails for single-tenant deployments where all parties share one org.
--
-- Changes:
--   1. Introduces assignment_strategy enum:
--        named        — step always routes to a specific defaultAssigneeId user
--        role_based   — any reviewer+ member of the participant entity's linked org
--        unassigned   — RESERVED; rejected by Phase-3 API; present for future use
--   2. Adds participant_id FK (nullable) — the primary routing reference.
--   3. Deprecates org_id: drops its NOT NULL constraint but keeps the column.
--      Existing production rows retain their org_id value unchanged.
--      The column is NOT dropped here — do that only after production has been
--      verified empty or fully migrated.

CREATE TYPE "assignment_strategy" AS ENUM ('named', 'role_based', 'unassigned');

ALTER TABLE "submission_chain_allowed_parties"
  ADD COLUMN "participant_id" integer
    REFERENCES "project_participants"("id") ON DELETE CASCADE,
  ADD COLUMN "assignment_strategy" "assignment_strategy" NOT NULL DEFAULT 'role_based';

-- Deprecate org_id: keep column, remove NOT NULL so new rows can omit it
ALTER TABLE "submission_chain_allowed_parties"
  ALTER COLUMN "org_id" DROP NOT NULL;

COMMENT ON COLUMN "submission_chain_allowed_parties"."org_id"
  IS 'DEPRECATED (Phase 3): replaced by participant_id. Do not write new values here. Drop after production has been verified clean.';

CREATE INDEX "idx_scap_participant_id" ON "submission_chain_allowed_parties" ("participant_id");
