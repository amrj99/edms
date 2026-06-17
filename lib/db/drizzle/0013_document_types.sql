CREATE TABLE "document_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
ALTER TABLE "wf_templates" ADD COLUMN "document_type_id" integer;--> statement-breakpoint
ALTER TABLE "metadata_fields" ADD COLUMN "document_type_id" integer;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wf_templates" ADD CONSTRAINT "wf_templates_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_fields" ADD CONSTRAINT "metadata_fields_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_types_org" ON "document_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_fields_document_type_id" ON "metadata_fields" USING btree ("document_type_id");--> statement-breakpoint
CREATE INDEX "idx_wf_templates_document_type_id" ON "wf_templates" USING btree ("document_type_id");
