-- Day-1 Hardening: missing index on documents.folder_id
--
-- documents.folderId is filtered in SQL at routes/documents.ts:236:
--   eq(documentsTable.folderId, parseInt(folderId as string))
-- Without this index, folder-filtered queries perform a full sequential scan
-- on the documents table for every paginated request.
--
-- Safe to re-run (IF NOT EXISTS). No data is changed.

CREATE INDEX IF NOT EXISTS "idx_documents_folder_id"
  ON "documents" ("folder_id");
