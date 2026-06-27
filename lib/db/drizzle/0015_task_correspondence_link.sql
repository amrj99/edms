-- Add 'document' value to task_source_type enum (fixes documents.ts bug).
-- ALTER TYPE ADD VALUE cannot run inside a transaction in older PG versions;
-- the statement-breakpoint below ensures Drizzle runs it in its own statement.
ALTER TYPE "task_source_type" ADD VALUE 'document';--> statement-breakpoint

-- Add assigned_at: tracks when the current assignedToId was set.
-- Updated only when assignedToId changes (not on title/status/priority edits).
-- Enables accurate "since when" for the future Waiting-for-Others view.
ALTER TABLE "tasks" ADD COLUMN "assigned_at" timestamp;
