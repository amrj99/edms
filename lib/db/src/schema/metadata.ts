import { pgTable, serial, text, timestamp, boolean, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMetadataFieldSchema = createInsertSchema(metadataFieldsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMetadataField = z.infer<typeof insertMetadataFieldSchema>;
export type MetadataField = typeof metadataFieldsTable.$inferSelect;
