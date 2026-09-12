ALTER TYPE "public"."notification_type" ADD VALUE 'submittal_forwarded' BEFORE 'mention';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'submittal_resubmitted' BEFORE 'mention';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'submittal_decided' BEFORE 'mention';