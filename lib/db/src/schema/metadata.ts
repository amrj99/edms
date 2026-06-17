import { pgTable, serial, text, timestamp, boolean, pgEnum, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { isNull, isNotNull, and } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { documentTypesTable } from "./document-types";

export const metadataFieldTypeEnum = pgEnum("metadata_field_type", [
  "text",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
]);

export const metadataAppliesToEnum = pgEnum("metadata_applies_to", [
  "document",
  "correspondence",
  "all",
]);

export const metadataFieldsTable = pgTable("metadata_fields", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  name: text("name").notNull(),
  label: text("label").notNull(),
  fieldType: metadataFieldTypeEnum("field_type").notNull(),
  options: text("options").array(),
  required: boolean("required").notNull().default(false),
  appliesTo: metadataAppliesToEnum("applies_to").notNull().default("document"),
  // Nullable: when null, the field applies per `appliesTo` (unchanged legacy behavior).
  // When set, the field is additionally scoped to this specific document type.
  documentTypeId: integer("document_type_id").references(() => documentTypesTable.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_metadata_fields_document_type_id").on(t.documentTypeId),
  // Org-scoped global fields (documentTypeId IS NULL): name unique per org.
  uniqueIndex("idx_metadata_fields_org_global_name")
    .on(t.organizationId, t.name)
    .where(and(isNotNull(t.organizationId), isNull(t.documentTypeId))),
  // Org-scoped type-specific fields: name unique per (org, documentType).
  uniqueIndex("idx_metadata_fields_org_type_name")
    .on(t.organizationId, t.documentTypeId, t.name)
    .where(and(isNotNull(t.organizationId), isNotNull(t.documentTypeId))),
  // System-global fields (organizationId IS NULL): name unique system-wide.
  uniqueIndex("idx_metadata_fields_system_global_name")
    .on(t.name)
    .where(isNull(t.organizationId)),
]);

export const insertMetadataFieldSchema = createInsertSchema(metadataFieldsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMetadataField = z.infer<typeof insertMetadataFieldSchema>;
export type MetadataField = typeof metadataFieldsTable.$inferSelect;
