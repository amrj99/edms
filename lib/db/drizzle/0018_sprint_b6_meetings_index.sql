-- Sprint B-6: meetings(organization_id, project_id) index
--
-- Context: ELASTICSEARCH_URL is not set in production — the SQL fallback in
-- search-service.ts is the active search path. The meetings table had zero
-- indexes; every search triggered a full sequential scan before applying ILIKE.
--
-- This composite index lets PostgreSQL satisfy the tenant/project WHERE clause
-- (organization_id = $1 AND project_id = $2) before evaluating ILIKE on title,
-- agenda, location, referenceNumber, and minutes.
--
-- Deferred (B-6 Phase 2 — requires EXPLAIN ANALYZE on production data or a
-- formal decision to keep SQL as the long-term search path):
--   • pg_trgm GIN indexes on correspondence.body and meetings.minutes
--   • PostgreSQL FTS (tsvector) on any table

CREATE INDEX IF NOT EXISTS "idx_meetings_org_project"
  ON "meetings" ("organization_id", "project_id");
