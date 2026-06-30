-- submission_chains tables are already included in 0000_init.sql for fresh installs.
-- This migration creates them incrementally for databases that were deployed
-- before submission_chains were part of the initial schema (old VPS scenario).
-- All statements use IF NOT EXISTS / exception guards so this is safe to run
-- regardless of whether the tables already exist.
CREATE TABLE IF NOT EXISTS "submission_chains" (
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
CREATE TABLE IF NOT EXISTS "submission_chain_allowed_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"label" text,
	"default_assignee_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_chain_steps" (
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
CREATE TABLE IF NOT EXISTS "submission_chain_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"revision_cycle" integer NOT NULL,
	"added_by_id" integer,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_originating_org_id_organizations_id_fk" FOREIGN KEY ("originating_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_current_org_id_organizations_id_fk" FOREIGN KEY ("current_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chains" ADD CONSTRAINT "submission_chains_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_allowed_parties" ADD CONSTRAINT "submission_chain_allowed_parties_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_from_org_id_organizations_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_to_org_id_organizations_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_actioned_by_id_users_id_fk" FOREIGN KEY ("actioned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_steps" ADD CONSTRAINT "submission_chain_steps_reassigned_by_id_users_id_fk" FOREIGN KEY ("reassigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_chain_id_submission_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."submission_chains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_revision_id_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_chain_documents" ADD CONSTRAINT "submission_chain_documents_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
