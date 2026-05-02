CREATE TYPE "public"."organization_type" AS ENUM('client', 'consultant', 'contractor', 'subcontractor');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('free', 'active', 'trialing', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('system_owner', 'admin', 'project_manager', 'document_controller', 'reviewer', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'under_review', 'approved', 'approved_with_comments', 'for_revision', 'rejected', 'issued', 'superseded', 'void', 'archived', 'obsolete');--> statement-breakpoint
CREATE TYPE "public"."correspondence_folder" AS ENUM('inbox', 'sent', 'draft', 'archive');--> statement-breakpoint
CREATE TYPE "public"."correspondence_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."correspondence_status" AS ENUM('draft', 'sent', 'read', 'responded', 'under_review', 'closed', 'overdue', 'recalled');--> statement-breakpoint
CREATE TYPE "public"."correspondence_type" AS ENUM('transmittal', 'letter', 'memo', 'rfi', 'notice', 'email', 'internal', 'submittal', 'ncr', 'technical_query', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_source_type" AS ENUM('manual', 'workflow', 'correspondence');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."metadata_applies_to" AS ENUM('document', 'correspondence', 'all');--> statement-breakpoint
CREATE TYPE "public"."metadata_field_type" AS ENUM('text', 'number', 'date', 'select', 'multiselect', 'boolean');--> statement-breakpoint
CREATE TYPE "public"."ai_module" AS ENUM('documents', 'correspondence', 'tasks', 'search', 'notifications', 'meetings', 'inspections');--> statement-breakpoint
CREATE TYPE "public"."ai_feature" AS ENUM('ai_summary', 'ai_classify', 'ai_extract', 'ai_search');--> statement-breakpoint
CREATE TYPE "public"."ai_transaction_type" AS ENUM('purchase', 'consumption', 'grant');--> statement-breakpoint
CREATE TYPE "public"."transmittal_status" AS ENUM('draft', 'sent', 'acknowledged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('document_uploaded', 'document_approved', 'document_rejected', 'document_approval_request', 'task_assigned', 'task_overdue', 'task_status_updated', 'action_item_assigned', 'correspondence_received', 'transmittal_received', 'transmittal_acknowledged', 'workflow_action_required', 'workflow_sla_reminder', 'rfi_opened', 'rfi_responded', 'submittal_returned', 'mention', 'chat_message', 'meeting_assigned', 'meeting_reminder', 'system');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('pending', 'scheduled', 'in_progress', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('itr', 'mir');--> statement-breakpoint
CREATE TYPE "public"."ncr_status" AS ENUM('open', 'in_progress', 'closed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."ncr_type" AS ENUM('ncr', 'sor');--> statement-breakpoint
CREATE TYPE "public"."noc_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('not_started', 'in_progress', 'submitted', 'approved', 'rejected', 'on_hold', 'closed');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."chat_group_type" AS ENUM('project', 'department', 'general');--> statement-breakpoint
CREATE TYPE "public"."chat_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."rule_applies_to" AS ENUM('document', 'correspondence', 'both');--> statement-breakpoint
CREATE TYPE "public"."skill_execution_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."skill_handler_type" AS ENUM('send_notification', 'send_email', 'change_status', 'generate_report');--> statement-breakpoint
CREATE TYPE "public"."skill_trigger_type" AS ENUM('document_uploaded', 'task_completed', 'project_status_changed', 'scheduled_daily', 'scheduled_weekly', 'scheduled_interval');--> statement-breakpoint
CREATE TYPE "public"."migration_item_status" AS ENUM('pending', 'analyzing', 'analyzed', 'confirmed', 'skipped', 'imported', 'failed');--> statement-breakpoint
CREATE TYPE "public"."migration_job_status" AS ENUM('pending', 'analyzing', 'awaiting_review', 'executing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."chain_step_action" AS ENUM('forward', 'return');--> statement-breakpoint
CREATE TYPE "public"."chain_step_status" AS ENUM('pending', 'under_review', 'reviewed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."submission_chain_status" AS ENUM('draft', 'active', 'returned', 'approved', 'approved_with_comments', 'closed');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"type" "organization_type" NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"subscription_tier" text DEFAULT 'free',
	"storage_used_mb" integer DEFAULT 0 NOT NULL,
	"corr_unread_reminder_hours" integer DEFAULT 48 NOT NULL,
	"corr_no_response_hours" integer DEFAULT 72 NOT NULL,
	"corr_sla_due_soon_hours" integer DEFAULT 24 NOT NULL,
	"trial_ends_at" timestamp,
	"ai_credits_balance" integer DEFAULT 0 NOT NULL,
	"ai_credits_total_purchased" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"plan_id" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" "subscription_status" DEFAULT 'free' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"seats_count" integer DEFAULT 1 NOT NULL,
	"payment_failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"organization_id" integer,
	"department" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"accepted_terms_at" timestamp,
	"accepted_terms_version" text,
	"password_changed_at" timestamp,
	"email_verified_at" timestamp,
	"email_verification_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"organization_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"document_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"file_type" text,
	"uploaded_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"document_id" integer NOT NULL,
	"revision" text NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"file_url" text,
	"file_name" text,
	"comment" text,
	"created_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"file_carried_forward" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"discipline" text DEFAULT '' NOT NULL,
	"doc_type" text DEFAULT '' NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_seq_scope_unique" UNIQUE("project_id","organization_id","discipline","doc_type")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"document_number" text NOT NULL,
	"title" text NOT NULL,
	"document_type" text,
	"discipline" text,
	"revision" text DEFAULT 'A' NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"folder_id" integer,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"share_token" text,
	"share_expires_at" timestamp,
	"share_password_hash" text,
	"additional_files" jsonb DEFAULT '[]'::jsonb,
	"source" text,
	"issued_by" text,
	"direction" text,
	"is_confidential" boolean DEFAULT false,
	"download_restricted" boolean DEFAULT false,
	"watermark_text" text,
	"ai_tags" jsonb DEFAULT '[]'::jsonb,
	"ai_priority" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_project_number_unique" UNIQUE("project_id","document_number")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_id" integer NOT NULL,
	"organization_id" integer,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondence_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondence_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondence_cc" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondence_id" integer NOT NULL,
	"user_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondence_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondence_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_id" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "correspondence_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondence_id" integer NOT NULL,
	"user_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondence_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scope" text NOT NULL,
	"project_id" integer,
	"year" integer NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondence" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"type" "correspondence_type" NOT NULL,
	"folder" "correspondence_folder" DEFAULT 'draft' NOT NULL,
	"body" text,
	"organization_id" integer,
	"from_user_id" integer NOT NULL,
	"project_id" integer,
	"scope" text DEFAULT 'project' NOT NULL,
	"parent_id" integer,
	"reference_number" text,
	"status" "correspondence_status" DEFAULT 'draft' NOT NULL,
	"priority" "correspondence_priority" DEFAULT 'medium' NOT NULL,
	"assigned_to_id" integer,
	"linked_document_id" integer,
	"package_id" integer,
	"due_date" timestamp,
	"sent_at" timestamp,
	"closed_at" timestamp,
	"recalled_at" timestamp,
	"recalled_by_id" integer,
	"direction" text,
	"requires_response" boolean DEFAULT false NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"first_read_at" timestamp,
	"share_token" text,
	"share_expires_at" timestamp,
	"share_password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf_instance_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"from_stage_id" integer,
	"to_stage_id" integer,
	"action" text NOT NULL,
	"actor_id" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer,
	"document_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"current_stage_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"initiated_by_id" integer NOT NULL,
	"stage_due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf_template_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"stage_order" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"responsible_role" text,
	"responsible_user_id" integer,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"sla_days" integer,
	"reminder_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wf_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"document_type" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"assigned_to_id" integer,
	"created_by_id" integer NOT NULL,
	"project_id" integer,
	"organization_id" integer,
	"source_type" "task_source_type" DEFAULT 'manual' NOT NULL,
	"source_id" integer,
	"due_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"field_type" "metadata_field_type" NOT NULL,
	"options" text[],
	"required" boolean DEFAULT false NOT NULL,
	"applies_to" "metadata_applies_to" DEFAULT 'document' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"organization_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_title" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"project_id" integer,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ai_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_revision" text,
	"analysis_type" text NOT NULL,
	"result" jsonb NOT NULL,
	"provider" text,
	"model" text,
	"tokens_used" integer,
	"latency_ms" integer,
	"triggered_by" integer,
	"is_latest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"analysis_type" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_cache_entity_analysis" UNIQUE("organization_id","entity_type","entity_id","analysis_type")
);
--> statement-breakpoint
CREATE TABLE "ai_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"user_id" integer,
	"module" "ai_module" NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"provider" text,
	"model" text,
	"tokens_used" integer,
	"latency_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"tier_minimum" text DEFAULT 'free' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_provider_model" UNIQUE("provider","model_id")
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"module" "ai_module" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_org_module" UNIQUE("organization_id","module")
);
--> statement-breakpoint
CREATE TABLE "ai_credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"transaction_type" "ai_transaction_type" NOT NULL,
	"feature" "ai_feature",
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmittal_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"transmittal_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"performed_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmittal_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transmittal_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"revision" text,
	"copies" integer DEFAULT 1,
	"purpose" text,
	"review_code" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmittals" (
	"id" serial PRIMARY KEY NOT NULL,
	"transmittal_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" "transmittal_status" DEFAULT 'draft' NOT NULL,
	"organization_id" integer,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"to_user_id" integer,
	"to_external" text,
	"sent_at" timestamp,
	"acknowledged_at" timestamp,
	"due_date" timestamp,
	"purpose" text DEFAULT 'for_information' NOT NULL,
	"share_token" text,
	"share_expires_at" timestamp,
	"share_password_hash" text,
	"approval_status" "approval_status" DEFAULT 'none' NOT NULL,
	"approved_by_id" integer,
	"approval_comment" text,
	"approved_at" timestamp,
	"external_emails" text,
	"cc_emails" text,
	"direction" text,
	"party_type" text,
	"review_code" text,
	"response_to_transmittal_id" integer,
	"review_outcome" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"is_scheduler_driven" boolean DEFAULT false NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_event_types_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"recipient_user_id" integer,
	"recipient_email" text,
	"organization_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"provider_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"project_id" integer,
	"entity_type" text,
	"entity_id" integer,
	"action_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "org_notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"event_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"threshold_hours" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "scheduled_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"fire_at" timestamp NOT NULL,
	"target_user_id" integer,
	"target_email" text,
	"entity_type" text,
	"entity_id" integer,
	"metadata" jsonb,
	"organization_id" integer,
	"project_id" integer,
	"sent_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_numbering_format" text DEFAULT '{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}' NOT NULL,
	"disciplines" jsonb DEFAULT '["Civil","Structural","Mechanical","Electrical","Piping","Instrumentation","HVAC","Fire Protection","Architectural","General"]'::jsonb NOT NULL,
	"document_types" jsonb DEFAULT '["Drawing","Specification","Report","Procedure","Datasheet","Certificate","Memo","Letter","Method Statement","ITP"]'::jsonb NOT NULL,
	"revision_format" text DEFAULT 'numeric' NOT NULL,
	"workflow_templates" jsonb DEFAULT '[{"id":"standard","name":"Standard Approval","steps":["Review","Check","Approve"],"type":"sequential"},{"id":"expedited","name":"Expedited Review","steps":["Review","Approve"],"type":"sequential"}]'::jsonb NOT NULL,
	"transmittal_prefix" text DEFAULT 'TRS' NOT NULL,
	"rfi_prefix" text DEFAULT 'RFI' NOT NULL,
	"submittal_prefix" text DEFAULT 'SUB' NOT NULL,
	"ncr_prefix" text DEFAULT 'NCR' NOT NULL,
	"sla_defaults" jsonb DEFAULT '{"rfi":7,"submittal":14,"transmittal":5,"ncr":14}'::jsonb NOT NULL,
	"system_name" text DEFAULT 'ArcScale EDMS',
	"logo_url" text,
	"primary_color" text DEFAULT '#2563eb',
	"storage_quota_mb" integer DEFAULT 10240,
	"storage_path" text,
	"storage_type" text DEFAULT 's3',
	"s3_endpoint" text,
	"s3_bucket" text,
	"s3_region" text,
	"s3_access_key" text,
	"s3_secret_key" text,
	"modules" jsonb DEFAULT '{"dashboard":true,"deliverables":true,"registers":true,"notifications":true}'::jsonb NOT NULL,
	"subscription_tier" text DEFAULT 'free',
	"ai_provider" text,
	"ai_model" text,
	"ai_daily_limit" integer DEFAULT 0,
	"ai_monthly_token_limit" integer DEFAULT 0,
	"ai_privacy_mode" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_config_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"type" "inspection_type" DEFAULT 'itr' NOT NULL,
	"description" text,
	"location" text,
	"date" timestamp,
	"status" "inspection_status" DEFAULT 'pending' NOT NULL,
	"contractor" text,
	"linked_correspondence_id" integer,
	"linked_document_id" integer,
	"remarks" text,
	"direction" text,
	"party_type" text,
	"review_code" text,
	"organization_id" integer,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"approval_status" "approval_status" DEFAULT 'none' NOT NULL,
	"approved_by_id" integer,
	"approval_comment" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncr_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_number" text NOT NULL,
	"type" "ncr_type" DEFAULT 'ncr' NOT NULL,
	"description" text,
	"location" text,
	"raised_by" text,
	"status" "ncr_status" DEFAULT 'open' NOT NULL,
	"corrective_action" text,
	"close_date" timestamp,
	"linked_document_id" integer,
	"linked_correspondence_id" integer,
	"remarks" text,
	"direction" text,
	"party_type" text,
	"review_code" text,
	"organization_id" integer,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"approval_status" "approval_status" DEFAULT 'none' NOT NULL,
	"approved_by_id" integer,
	"approval_comment" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "noc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"noc_number" text NOT NULL,
	"authority" text,
	"date" timestamp,
	"status" "noc_status" DEFAULT 'pending' NOT NULL,
	"linked_document_id" integer,
	"linked_correspondence_id" integer,
	"remarks" text,
	"direction" text,
	"party_type" text,
	"organization_id" integer,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" serial PRIMARY KEY NOT NULL,
	"deliverable_id" text NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"planned_date" timestamp,
	"actual_date" timestamp,
	"status" "deliverable_status" DEFAULT 'not_started' NOT NULL,
	"responsible" text,
	"linked_document_id" integer,
	"remarks" text,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"dashboard_widgets" jsonb,
	"dashboard_layout" jsonb,
	"saved_filters" jsonb,
	"column_prefs" jsonb,
	"notification_prefs" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"organization_id" integer,
	"title" text NOT NULL,
	"assigned_to_id" integer,
	"assigned_to_name" text,
	"due_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"organization_id" integer,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"organization_id" integer,
	"user_id" integer,
	"name" text,
	"email" text,
	"attended" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"project_id" integer,
	"organization_id" integer,
	"organized_by_id" integer NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"location" text,
	"meeting_link" text,
	"meeting_date" timestamp NOT NULL,
	"duration" integer,
	"agenda" text,
	"minutes" text,
	"reference_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "chat_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "chat_group_type" DEFAULT 'general' NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer,
	"department" text,
	"created_by_id" integer NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"content" text NOT NULL,
	"parent_id" integer,
	"message_type" text DEFAULT 'text' NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_execution_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"actions_taken" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"applies_to" "rule_applies_to" DEFAULT 'both' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" integer NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_failed_at" timestamp,
	"is_circuit_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" "skill_trigger_type" NOT NULL,
	"handler_type" "skill_handler_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"triggered_by_type" text DEFAULT 'cron' NOT NULL,
	"triggered_by_id" integer,
	"status" "skill_execution_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"file_type" text,
	"file_url" text,
	"extracted_title" text,
	"extracted_code" text,
	"extracted_discipline" text,
	"extracted_doc_type" text,
	"extracted_revision" text,
	"extracted_date" text,
	"extracted_issuer" text,
	"extracted_is_reply" integer DEFAULT 0,
	"extracted_reply_to" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"confidence_label" text,
	"title" text,
	"code" text,
	"discipline" text,
	"doc_type" text,
	"revision" text,
	"doc_date" text,
	"issuer" text,
	"conflict_document_id" integer,
	"conflict_document_title" text,
	"conflict_document_revision" text,
	"import_mode" text DEFAULT 'new_document',
	"status" "migration_item_status" DEFAULT 'pending' NOT NULL,
	"skip" integer DEFAULT 0 NOT NULL,
	"imported_document_id" integer,
	"error_message" text,
	"analyzed_at" timestamp,
	"imported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"status" "migration_job_status" DEFAULT 'pending' NOT NULL,
	"plan" text DEFAULT 'basic' NOT NULL,
	"max_files" integer DEFAULT 200 NOT NULL,
	"storage_mode" text,
	"base_url" text,
	"imported_count" integer,
	"skipped_count" integer,
	"failed_count" integer,
	"incomplete_count" integer,
	"revised_count" integer,
	"generated_registers" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"from_user_id" integer NOT NULL,
	"to_user_id" integer NOT NULL,
	"project_id" integer,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"granted_by_user_id" integer NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "project_role_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role_override" "user_role" NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"granted_by_user_id" integer NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "submission_chain_allowed_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"label" text,
	"default_assignee_id" integer
);
--> statement-breakpoint
CREATE TABLE "submission_chain_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"revision_cycle" integer NOT NULL,
	"added_by_id" integer,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_chain_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"step_number" integer NOT NULL,
	"revision_cycle" integer NOT NULL,
	"action" "chain_step_action" NOT NULL,
	"from_org_id" integer NOT NULL,
	"to_org_id" integer NOT NULL,
	"actioned_by_id" integer,
	"step_status" "chain_step_status" DEFAULT 'pending' NOT NULL,
	"review_code" text,
	"comments" text,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp,
	"transmittal_id" integer,
	"assigned_to_user_id" integer,
	"reassigned_at" timestamp,
	"reassigned_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" integer NOT NULL,
	"originating_org_id" integer NOT NULL,
	"current_org_id" integer NOT NULL,
	"current_status" "submission_chain_status" DEFAULT 'draft' NOT NULL,
	"active_revision_cycle" integer DEFAULT 1 NOT NULL,
	"current_step_started_at" timestamp DEFAULT now() NOT NULL,
	"auto_closed_at" timestamp,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "submission_chains_chain_number_unique" UNIQUE("chain_number")
);
--> statement-breakpoint
CREATE TABLE "org_feature_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"feature_key" text NOT NULL,
	"is_enabled" boolean NOT NULL,
	"reason" text,
	"granted_by_user_id" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_feature_overrides_org_feature_uq" UNIQUE("organization_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "org_quota_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"quota_key" text NOT NULL,
	"quota_value" integer NOT NULL,
	"reason" text,
	"granted_by_user_id" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_quota_overrides_org_quota_uq" UNIQUE("organization_id","quota_key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_aed" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'aed' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"min_users" integer,
	"max_users" integer,
	"storage_mb" integer DEFAULT 0 NOT NULL,
	"max_file_size_mb" integer DEFAULT 1024 NOT NULL,
	"migration_max_files" integer DEFAULT 0 NOT NULL,
	"rate_limit_rpm" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stripe_price_env" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "document_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doc_dept_unique" UNIQUE("document_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "project_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proj_dept_unique" UNIQUE("project_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "user_departments" (
	"user_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "access_shadow_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"user_id" integer NOT NULL,
	"user_role" text NOT NULL,
	"project_id" integer,
	"system_allowed" boolean NOT NULL,
	"resolver_allowed" boolean NOT NULL,
	"resolver_reasons" text[] DEFAULT '{}' NOT NULL,
	"rule_path" text NOT NULL,
	"diverges" boolean NOT NULL,
	"user_dept_ids" integer[] DEFAULT '{}' NOT NULL,
	"doc_dept_ids" integer[] DEFAULT '{}' NOT NULL,
	"has_confidential" boolean DEFAULT false NOT NULL,
	"has_deny_rule" boolean DEFAULT false NOT NULL,
	"has_workflow_grant" boolean DEFAULT false NOT NULL,
	"evaluated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_access_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"rule_type" text NOT NULL,
	"granted_by_id" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doc_access_rule_uniq" UNIQUE("document_id","department_id","rule_type")
);
--> statement-breakpoint
CREATE TABLE "document_confidential_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" integer,
	"department_id" integer,
	"granted_by_id" integer,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "external_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"job_title" text,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_attachments" ADD CONSTRAINT "correspondence_attachments_correspondence_id_correspondence_id_fk" FOREIGN KEY ("correspondence_id") REFERENCES "public"."correspondence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_cc" ADD CONSTRAINT "correspondence_cc_correspondence_id_correspondence_id_fk" FOREIGN KEY ("correspondence_id") REFERENCES "public"."correspondence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_cc" ADD CONSTRAINT "correspondence_cc_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_documents" ADD CONSTRAINT "correspondence_documents_correspondence_id_correspondence_id_fk" FOREIGN KEY ("correspondence_id") REFERENCES "public"."correspondence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_documents" ADD CONSTRAINT "correspondence_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_documents" ADD CONSTRAINT "correspondence_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_recipients" ADD CONSTRAINT "correspondence_recipients_correspondence_id_correspondence_id_fk" FOREIGN KEY ("correspondence_id") REFERENCES "public"."correspondence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_recipients" ADD CONSTRAINT "correspondence_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_sequences" ADD CONSTRAINT "correspondence_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence_sequences" ADD CONSTRAINT "correspondence_sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_recalled_by_id_users_id_fk" FOREIGN KEY ("recalled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instance_transitions" ADD CONSTRAINT "wf_instance_transitions_instance_id_wf_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."wf_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instance_transitions" ADD CONSTRAINT "wf_instance_transitions_from_stage_id_wf_template_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."wf_template_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instance_transitions" ADD CONSTRAINT "wf_instance_transitions_to_stage_id_wf_template_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."wf_template_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instance_transitions" ADD CONSTRAINT "wf_instance_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_template_id_wf_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."wf_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_current_stage_id_wf_template_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."wf_template_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_instances" ADD CONSTRAINT "wf_instances_initiated_by_id_users_id_fk" FOREIGN KEY ("initiated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_template_stages" ADD CONSTRAINT "wf_template_stages_template_id_wf_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."wf_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_template_stages" ADD CONSTRAINT "wf_template_stages_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_templates" ADD CONSTRAINT "wf_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_templates" ADD CONSTRAINT "wf_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_fields" ADD CONSTRAINT "metadata_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_history" ADD CONSTRAINT "transmittal_history_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_notification_settings" ADD CONSTRAINT "org_notification_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_notification_settings" ADD CONSTRAINT "org_notification_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_config" ADD CONSTRAINT "org_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_records" ADD CONSTRAINT "ncr_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_records" ADD CONSTRAINT "ncr_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_records" ADD CONSTRAINT "ncr_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_records" ADD CONSTRAINT "ncr_records_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noc_records" ADD CONSTRAINT "noc_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organized_by_id_users_id_fk" FOREIGN KEY ("organized_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_members" ADD CONSTRAINT "chat_group_members_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_members" ADD CONSTRAINT "chat_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_execution_logs" ADD CONSTRAINT "rule_execution_logs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_execution_logs" ADD CONSTRAINT "rule_execution_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD CONSTRAINT "skill_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD CONSTRAINT "skill_definitions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_skill_id_skill_definitions_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_items" ADD CONSTRAINT "migration_items_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_items" ADD CONSTRAINT "migration_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_overrides" ADD CONSTRAINT "project_role_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_overrides" ADD CONSTRAINT "project_role_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_overrides" ADD CONSTRAINT "project_role_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_overrides" ADD CONSTRAINT "project_role_overrides_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_overrides" ADD CONSTRAINT "project_role_overrides_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_revision_id_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_from_org_id_organizations_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_to_org_id_organizations_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_actioned_by_id_users_id_fk" FOREIGN KEY ("actioned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_reassigned_by_id_users_id_fk" FOREIGN KEY ("reassigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_originating_org_id_organizations_id_fk" FOREIGN KEY ("originating_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_current_org_id_organizations_id_fk" FOREIGN KEY ("current_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_feature_overrides" ADD CONSTRAINT "org_feature_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_feature_overrides" ADD CONSTRAINT "org_feature_overrides_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_quota_overrides" ADD CONSTRAINT "org_quota_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_quota_overrides" ADD CONSTRAINT "org_quota_overrides_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_departments" ADD CONSTRAINT "document_departments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_departments" ADD CONSTRAINT "document_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_departments" ADD CONSTRAINT "project_departments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_departments" ADD CONSTRAINT "project_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_rules" ADD CONSTRAINT "document_access_rules_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_rules" ADD CONSTRAINT "document_access_rules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_rules" ADD CONSTRAINT "document_access_rules_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confidential_access" ADD CONSTRAINT "document_confidential_access_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confidential_access" ADD CONSTRAINT "document_confidential_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confidential_access" ADD CONSTRAINT "document_confidential_access_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confidential_access" ADD CONSTRAINT "document_confidential_access_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_contacts" ADD CONSTRAINT "external_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_organization_id" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_project_members_project_id" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_members_user_id" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_projects_organization_id" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_documents_organization_id" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_documents_project_id" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_documents_status" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "correspondence_documents_uniq" ON "correspondence_documents" USING btree ("correspondence_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "correspondence_seq_uniq" ON "correspondence_sequences" USING btree ("organization_id","scope","project_id","year");--> statement-breakpoint
CREATE INDEX "idx_tasks_organization_id" ON "tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_project_id" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned_to_id" ON "tasks" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_organization_id" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_project_id" ON "audit_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_analysis_entity" ON "ai_analysis" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_ai_analysis_org" ON "ai_analysis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ai_analysis_latest" ON "ai_analysis" USING btree ("entity_type","entity_id","analysis_type","is_latest");--> statement-breakpoint
CREATE INDEX "idx_ai_analysis_org_type_latest" ON "ai_analysis" USING btree ("organization_id","entity_type","is_latest");--> statement-breakpoint
CREATE INDEX "idx_ai_cache_organization_id" ON "ai_cache" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ai_logs_organization_id" ON "ai_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ai_logs_user_id" ON "ai_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_logs_module" ON "ai_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "idx_ai_models_provider" ON "ai_models" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_ai_models_active" ON "ai_models" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_notif_log_recipient" ON "notification_logs" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "idx_notif_log_entity" ON "notification_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_notif_log_created" ON "notification_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_organization_id" ON "notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_is_read" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "idx_org_notif_org" ON "org_notification_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_sched_notif_fire" ON "scheduled_notifications" USING btree ("fire_at");--> statement-breakpoint
CREATE INDEX "idx_sched_notif_entity" ON "scheduled_notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_rule_exec_logs_rule_id" ON "rule_execution_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_rule_exec_logs_organization_id" ON "rule_execution_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_rule_exec_logs_executed_at" ON "rule_execution_logs" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_rules_organization_id" ON "rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_rules_is_enabled" ON "rules" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "idx_skill_executions_skill_id" ON "skill_executions" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "idx_skill_executions_org_id" ON "skill_executions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_skill_executions_executed_at" ON "skill_executions" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_skill_executions_status" ON "skill_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_delegations_org_id" ON "delegations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_from_user_id" ON "delegations" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_to_user_id" ON "delegations" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_project_id" ON "delegations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_delegations_expires_at" ON "delegations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_proj_role_overrides_org_id" ON "project_role_overrides" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_proj_role_overrides_project_id" ON "project_role_overrides" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_proj_role_overrides_user_id" ON "project_role_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_proj_role_overrides_expires_at" ON "project_role_overrides" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_departments_org" ON "departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_doc_departments_doc" ON "document_departments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_doc_departments_dept" ON "document_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_proj_departments_proj" ON "project_departments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_proj_departments_dept" ON "project_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_user_departments_user" ON "user_departments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_departments_dept" ON "user_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_shadow_doc" ON "access_shadow_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_shadow_user" ON "access_shadow_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_shadow_diverges" ON "access_shadow_log" USING btree ("diverges");--> statement-breakpoint
CREATE INDEX "idx_shadow_evaluated_at" ON "access_shadow_log" USING btree ("evaluated_at");--> statement-breakpoint
CREATE INDEX "idx_doc_access_rules_doc" ON "document_access_rules" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_doc_access_rules_dept" ON "document_access_rules" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_doc_conf_doc" ON "document_confidential_access" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_doc_conf_user" ON "document_confidential_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_doc_conf_dept" ON "document_confidential_access" USING btree ("department_id");