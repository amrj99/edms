ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "session_timeout_minutes" integer;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "idle_timeout_minutes" integer;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "remember_me_enabled" boolean;--> statement-breakpoint
ALTER TABLE "org_config" ADD COLUMN "remember_me_days" integer;