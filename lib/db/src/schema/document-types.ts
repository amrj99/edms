import { pgTable, serial, text, timestamp, boolean, integer, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

/**
 * document_types — per-organization registry of document type definitions.
 *
 * `code` is the stable identifier: it is set at creation and must not be
 * changed afterwards (enforced at the API layer), because it is the link
 * between this row and `documents.documentType` (text) and
 * `wf_templates.documentType` (text) for backward-compatible matching.
 */
export const documentTypesTable = pgTable("document_types", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("document_types_org_code_unique").on(t.organizationId, t.code),
  index("idx_document_types_org").on(t.organizationId),
]);

export const insertDocumentTypeSchema = createInsertSchema(documentTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentType = z.infer<typeof insertDocumentTypeSchema>;
export type DocumentType = typeof documentTypesTable.$inferSelect;
