-- Phase 1 — Domain Model: Organization → Entity optional link
-- Adds entity_id (nullable FK) to organizations.
-- Allows 1:N structurally: one Entity may be linked to multiple Organizations.
-- Behavior remains per-tenant; no shared logic is activated by this field.
-- No existing rows are affected — NULL is the default.

ALTER TABLE "organizations"
  ADD COLUMN "entity_id" integer REFERENCES "entities"("id") ON DELETE SET NULL;

CREATE INDEX "idx_organizations_entity_id" ON "organizations" ("entity_id");
