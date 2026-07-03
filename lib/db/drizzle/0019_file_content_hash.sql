-- Sprint C-4: Content Hash
-- Adds sha256 column to document_files for file integrity verification.
-- NULL for existing files (no backfill — files uploaded before this migration
-- have no stored hash). New uploads compute SHA-256 server-side at upload time.
ALTER TABLE document_files ADD COLUMN sha256 TEXT;
