-- Phase 3 — Submittal Lifecycle: chain type classification
--
-- type:                  Defaults to 'submittal'. Values 'rfi', 'ncr', 'mir' are
--                        registered here for future use — Phase 3 API endpoints
--                        do not yet distinguish behaviour between types.
--
-- current_participant_id: Nullable FK to project_participants. Set by
--                         setup-parties and updated on every forward/return/resubmit.
--                         Coexists with current_org_id (kept for legacy compat) so
--                         that chains created before Phase 3 still work.

ALTER TABLE "submission_chains"
  ADD COLUMN "type" text NOT NULL DEFAULT 'submittal',
  ADD COLUMN "current_participant_id" integer
    REFERENCES "project_participants"("id") ON DELETE SET NULL;

ALTER TABLE "submission_chains"
  ADD CONSTRAINT "submission_chains_type_check"
  CHECK (type IN ('submittal', 'rfi', 'ncr', 'mir'));

CREATE INDEX "idx_sc_type"                ON "submission_chains" ("type");
CREATE INDEX "idx_sc_current_participant" ON "submission_chains" ("current_participant_id");
