-- Phase 1 — Domain Model: Entity Directory
-- Creates the entities table for Local Directory (per-tenant entity management).
-- Each organization manages its own list of entities independently.
-- No cross-tenant sharing in Phase 1 — Global Directory is deferred.

CREATE TYPE entity_type AS ENUM ('company', 'government', 'individual', 'ngo', 'consortium');

CREATE TABLE "entities" (
  "id"                  serial PRIMARY KEY,
  "organization_id"     integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"                text NOT NULL,
  "type"                entity_type NOT NULL,
  "country"             text,
  "registration_number" text,
  "parent_entity_id"    integer REFERENCES "entities"("id") ON DELETE SET NULL,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "idx_entities_org_id" ON "entities" ("organization_id");
CREATE INDEX "idx_entities_name"   ON "entities" ("name");
