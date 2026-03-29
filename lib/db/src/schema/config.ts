import { pgTable, serial, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const orgConfigTable = pgTable("org_config", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull().unique(),
  documentNumberingFormat: text("document_numbering_format").notNull().default("{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}"),
  disciplines: jsonb("disciplines").notNull().default([
    "Civil", "Structural", "Mechanical", "Electrical", "Piping",
    "Instrumentation", "HVAC", "Fire Protection", "Architectural", "General"
  ]),
  documentTypes: jsonb("document_types").notNull().default([
    "Drawing", "Specification", "Report", "Procedure", "Datasheet",
    "Certificate", "Memo", "Letter", "Method Statement", "ITP"
  ]),
  revisionFormat: text("revision_format").notNull().default("numeric"),
  workflowTemplates: jsonb("workflow_templates").notNull().default([
    {
      id: "standard",
      name: "Standard Approval",
      steps: ["Review", "Check", "Approve"],
      type: "sequential"
    },
    {
      id: "expedited",
      name: "Expedited Review",
      steps: ["Review", "Approve"],
      type: "sequential"
    }
  ]),
  transmittalPrefix: text("transmittal_prefix").notNull().default("TRS"),
  rfiPrefix: text("rfi_prefix").notNull().default("RFI"),
  submittalPrefix: text("submittal_prefix").notNull().default("SUB"),
  ncrPrefix: text("ncr_prefix").notNull().default("NCR"),
  slaDefaults: jsonb("sla_defaults").notNull().default({
    rfi: 7,
    submittal: 14,
    transmittal: 5,
    ncr: 14
  }),
  systemName: text("system_name").default("ArcScale EDMS"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#2563eb"),
  storageQuotaMb: integer("storage_quota_mb").default(10240),
  storagePath: text("storage_path"),
  storageType: text("storage_type").default("cloud"), // 'cloud' | 'onpremise'
  s3Endpoint: text("s3_endpoint"),
  s3Bucket: text("s3_bucket"),
  s3Region: text("s3_region"),
  s3AccessKey: text("s3_access_key"),
  s3SecretKey: text("s3_secret_key"),
  modules: jsonb("modules").notNull().default({
    dashboard: true,
    deliverables: true,
    registers: true,
    notifications: true,
  }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrgConfigSchema = createInsertSchema(orgConfigTable).omit({
  id: true,
  updatedAt: true,
});

export type OrgConfig = typeof orgConfigTable.$inferSelect;
export type InsertOrgConfig = z.infer<typeof insertOrgConfigSchema>;

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
