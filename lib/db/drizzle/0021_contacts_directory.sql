-- Phase 1 — Domain Model: Contacts Directory
-- Creates contacts table: persons representing an Entity.
-- user_id is nullable — a contact may exist without an ArcScale account (deferred link).
-- Distinct from the legacy external_contacts table (no entityId FK there).

CREATE TABLE "contacts" (
  "id"        serial PRIMARY KEY,
  "entity_id" integer NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "name"      text NOT NULL,
  "email"     text,
  "phone"     text,
  "job_title" text,
  "user_id"   integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "idx_contacts_entity_id" ON "contacts" ("entity_id");
CREATE INDEX "idx_contacts_user_id"   ON "contacts" ("user_id");
