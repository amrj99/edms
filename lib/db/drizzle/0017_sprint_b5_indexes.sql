-- Sprint B-5: Phase 1 — Query-backed indexes only
--
-- Each index below maps to an active query in the current codebase.
-- Phase 2 indexes (folders.parent_id, documents composite, org_notification_settings,
-- scheduled_notifications partial) are deferred until EXPLAIN ANALYZE on production
-- data confirms they are necessary.
--
-- All statements use IF NOT EXISTS so this migration is safe to re-run.

-- I-01: folders(project_id)
-- Serves: GET /api/projects/:id/documents/folders
--   WHERE project_id = $1 ORDER BY parent_id NULLS FIRST, name ASC
CREATE INDEX IF NOT EXISTS "idx_folders_project_id"
  ON "folders" ("project_id");
--> statement-breakpoint

-- I-03: correspondence(organization_id, project_id, updated_at DESC)
-- Serves: GET /api/projects/:id/correspondence (wantsViewAll + sent paths)
--   WHERE organization_id = $1 AND project_id = $2 ORDER BY updated_at DESC
--   The DESC on updated_at matches the ORDER BY so PostgreSQL can avoid a filesort.
CREATE INDEX IF NOT EXISTS "idx_correspondence_org_project_updated"
  ON "correspondence" ("organization_id", "project_id", "updated_at" DESC);
--> statement-breakpoint

-- I-04: correspondence_recipients(correspondence_id)
-- Serves: enrichCorrespondence batch recipient lookup
--   WHERE correspondence_id IN (id1, id2, ..., idN)
CREATE INDEX IF NOT EXISTS "idx_corr_recipients_corr_id"
  ON "correspondence_recipients" ("correspondence_id");
--> statement-breakpoint

-- I-05: correspondence_recipients(user_id)
-- Serves: GET /correspondence mail-model — find correspondence where caller is a recipient
--   WHERE user_id = $userId
CREATE INDEX IF NOT EXISTS "idx_corr_recipients_user_id"
  ON "correspondence_recipients" ("user_id");
--> statement-breakpoint

-- I-06: correspondence_cc(correspondence_id)
-- Serves: enrichCorrespondence batch CC lookup
--   WHERE correspondence_id IN (id1, id2, ..., idN)
CREATE INDEX IF NOT EXISTS "idx_corr_cc_corr_id"
  ON "correspondence_cc" ("correspondence_id");
--> statement-breakpoint

-- I-07: correspondence_cc(user_id)
-- Serves: GET /correspondence mail-model — find correspondence where caller is CC'd
--   WHERE user_id = $userId
CREATE INDEX IF NOT EXISTS "idx_corr_cc_user_id"
  ON "correspondence_cc" ("user_id");
--> statement-breakpoint

-- I-08: correspondence_attachments(correspondence_id)
-- Serves: enrichCorrespondence batch attachment lookup
--   WHERE correspondence_id IN (id1, id2, ..., idN)
CREATE INDEX IF NOT EXISTS "idx_corr_attachments_corr_id"
  ON "correspondence_attachments" ("correspondence_id");
