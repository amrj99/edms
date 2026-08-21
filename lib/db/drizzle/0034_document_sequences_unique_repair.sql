-- DEBT-005 repair migration.
--
-- The document_sequences unique constraint `doc_seq_scope_unique`
-- (project_id, organization_id, discipline, doc_type) is defined in the schema
-- and present in 0000_init. However, databases that were created BEFORE that
-- constraint existed had 0000 *baselined* by the runtime migrator (marked applied
-- without re-running it), so they never received the constraint. Without it, the
-- auto-numbering upsert `INSERT ... ON CONFLICT (project_id, organization_id,
-- discipline, doc_type) DO UPDATE` fails ("no unique or exclusion constraint
-- matching the ON CONFLICT specification") → document creation returns HTTP 500.
--
-- This forward migration adds the constraint idempotently so any baselined DB is
-- repaired, while fresh DBs (which already have it from 0000) are unaffected.
-- Safe: additive only. Guarded so it never errors if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doc_seq_scope_unique'
  ) THEN
    ALTER TABLE "document_sequences"
      ADD CONSTRAINT "doc_seq_scope_unique"
      UNIQUE ("project_id", "organization_id", "discipline", "doc_type");
  END IF;
END $$;
