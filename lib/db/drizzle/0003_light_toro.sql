ALTER TABLE "users" ADD COLUMN "is_read_only_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "visible_on_free" boolean DEFAULT true NOT NULL;