ALTER TYPE "public"."subscription_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan_id" SET DEFAULT 'expired';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'expired';