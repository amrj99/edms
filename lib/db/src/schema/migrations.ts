import { pgTable, serial, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const migrationJobStatusEnum = pgEnum("migration_job_status", [
  "pending",
  "analyzing",
  "awaiting_review",
  "executing",
  "completed",
  "failed",
]);

export const migrationItemStatusEnum = pgEnum("migration_item_status", [
  "pending",
  "analyzing",
  "analyzed",
  "confirmed",
  "skipped",
  "imported",
  "failed",
]);

/**
 * One record per wizard session (per project import run).
 */
export const migrationJobsTable = pgTable("migration_jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  status: migrationJobStatusEnum("status").notNull().default("pending"),
  // Plan limits
  plan: text("plan").notNull().default("basic"),            // basic | professional | enterprise
  maxFiles: integer("max_files").notNull().default(200),
  // Storage choice set in step 4
  storageMode: text("storage_mode"),                        // "system" | "reference"
  baseUrl: text("base_url"),                                // used when storageMode = "reference"
  // Final counts
  importedCount: integer("imported_count"),
  skippedCount: integer("skipped_count"),
  failedCount: integer("failed_count"),
  incompleteCount: integer("incomplete_count"),             // imported but flagged as incomplete
  revisedCount: integer("revised_count"),                   // imported as new revision of existing doc
  // Summary of generated registers
  generatedRegisters: jsonb("generated_registers").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * One row per file staged in the wizard.
 */
export const migrationItemsTable = pgTable("migration_items", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => migrationJobsTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  // Original file info
  filePath: text("file_path").notNull(),           // relative path from root (folder/sub/file.pdf)
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  fileType: text("file_type"),                     // MIME or extension
  fileUrl: text("file_url"),                       // set after upload to storage
  // AI extraction results
  extractedTitle: text("extracted_title"),
  extractedCode: text("extracted_code"),
  extractedDiscipline: text("extracted_discipline"),
  extractedDocType: text("extracted_doc_type"),
  extractedRevision: text("extracted_revision"),
  extractedDate: text("extracted_date"),
  extractedIssuer: text("extracted_issuer"),
  extractedIsReply: integer("extracted_is_reply").default(0),  // 0=no, 1=yes
  extractedReplyTo: text("extracted_reply_to"),
  confidence: integer("confidence").notNull().default(0),      // 0–100
  confidenceLabel: text("confidence_label"),                   // "high"|"medium"|"low"|"unreadable"
  // User overrides (same fields — override takes priority over extracted)
  title: text("title"),
  code: text("code"),
  discipline: text("discipline"),
  docType: text("doc_type"),
  revision: text("revision"),
  docDate: text("doc_date"),
  issuer: text("issuer"),
  // Conflict detection — populated after analysis when doc number matches an existing project document
  conflictDocumentId: integer("conflict_document_id"),          // existing document's ID (null = no conflict)
  conflictDocumentTitle: text("conflict_document_title"),       // existing document's title (denormalised for display)
  conflictDocumentRevision: text("conflict_document_revision"), // existing document's current revision
  importMode: text("import_mode").default("new_document"),      // "new_document" | "new_revision"
  // Workflow
  status: migrationItemStatusEnum("status").notNull().default("pending"),
  skip: integer("skip").notNull().default(0),
  importedDocumentId: integer("imported_document_id"),
  errorMessage: text("error_message"),
  analyzedAt: timestamp("analyzed_at"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMigrationJobSchema = createInsertSchema(migrationJobsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertMigrationItemSchema = createInsertSchema(migrationItemsTable).omit({
  id: true, createdAt: true,
});

export type MigrationJob = typeof migrationJobsTable.$inferSelect;
export type MigrationItem = typeof migrationItemsTable.$inferSelect;
export type InsertMigrationJob = z.infer<typeof insertMigrationJobSchema>;
export type InsertMigrationItem = z.infer<typeof insertMigrationItemSchema>;
