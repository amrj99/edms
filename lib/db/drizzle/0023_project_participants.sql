-- Phase 2 — Domain Model: Project Participants
-- Links an Entity to a Project with a participation role.
--
-- Design decisions:
--   - participant_role is a fixed enum (not text) to ensure consistent filtering/reporting.
--     Values cover construction/infrastructure domain: owner, consultant, main_contractor,
--     sub_contractor, supplier, authority, other.
--   - UNIQUE (project_id, entity_id): one Entity → one role per Project in Phase 2.
--     Multi-role participation is deferred; lift this constraint if needed in a later phase.
--   - Tenant isolation is enforced at the application layer: both project.organization_id
--     and entity.organization_id must match the caller's org. No cross-tenant participants.
--   - No authorization implications in Phase 2 — purely a directory annotation.
--     Integration with documents/correspondence deferred to Phase 3+.

CREATE TYPE participant_role AS ENUM (
  'owner',
  'consultant',
  'main_contractor',
  'sub_contractor',
  'supplier',
  'authority',
  'other'
);

CREATE TABLE "project_participants" (
  "id"         serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "entity_id"  integer NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "role"       participant_role NOT NULL,
  "notes"      text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_entity UNIQUE ("project_id", "entity_id")
);

CREATE INDEX "idx_pp_project_id" ON "project_participants" ("project_id");
CREATE INDEX "idx_pp_entity_id"  ON "project_participants" ("entity_id");
