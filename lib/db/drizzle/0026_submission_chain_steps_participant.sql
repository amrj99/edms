-- Phase 3 — Submittal Lifecycle: participant-level tracking in step history
--
-- Adds from_participant_id / to_participant_id to submission_chain_steps so
-- that the audit trail records participant roles, not just org ids.
--
-- from_org_id / to_org_id remain NOT NULL: the route layer resolves an org
-- from the participant's linked entity (via organizations.entity_id), falling
-- back to caller's org for single-tenant scenarios.
--
-- Both new columns are nullable: pre-Phase-3 steps will have NULL here, which
-- is expected and correct.

ALTER TABLE "submission_chain_steps"
  ADD COLUMN "from_participant_id" integer
    REFERENCES "project_participants"("id") ON DELETE SET NULL,
  ADD COLUMN "to_participant_id" integer
    REFERENCES "project_participants"("id") ON DELETE SET NULL;

CREATE INDEX "idx_scs_from_participant" ON "submission_chain_steps" ("from_participant_id");
CREATE INDEX "idx_scs_to_participant"   ON "submission_chain_steps" ("to_participant_id");
