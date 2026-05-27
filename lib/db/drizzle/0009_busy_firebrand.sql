ALTER TABLE "users" ADD COLUMN "email_verification_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "before_state" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "after_state" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "ai_plan" text DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "ai_monthly_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs" USING btree ("user_id","created_at");