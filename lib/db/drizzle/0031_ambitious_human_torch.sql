ALTER TABLE "document_files" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "deleted_by_id" integer;--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "purge_after" timestamp;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;