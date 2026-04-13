import { pgTable, serial, text, timestamp, integer, boolean, jsonb, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "under_review",
  "approved",
  "approved_with_comments",
  "for_revision",
  "rejected",
  "issued",
  "superseded",
  "void",
  "archived",
  "obsolete",
]);

export const foldersTable = pgTable("folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  documentNumber: text("document_number").notNull(),
  title: text("title").notNull(),
  documentType: text("document_type"),
  discipline: text("discipline"),
  revision: text("revision").notNull().default("A"),
  status: documentStatusEnum("status").notNull().default("draft"),
  description: text("description"),
  folderId: integer("folder_id").references(() => foldersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  metadata: jsonb("metadata").default({}),
  shareToken: text("share_token"),
  shareExpiresAt: timestamp("share_expires_at"),
  sharePasswordHash: text("share_password_hash"),
  additionalFiles: jsonb("additional_files").default([]),
  source: text("source"),
  issuedBy: text("issued_by"),
  direction: text("direction", { enum: ["incoming", "outgoing"] }),
  isConfidential: boolean("is_confidential").default(false),
  downloadRestricted: boolean("download_restricted").default(false),
  watermarkText: text("watermark_text"),
  aiTags: jsonb("ai_tags").$type<string[]>().default([]),
  aiPriority: text("ai_priority"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_documents_organization_id").on(t.organizationId),
  index("idx_documents_project_id").on(t.projectId),
  index("idx_documents_status").on(t.status),
  unique("documents_project_number_unique").on(t.projectId, t.documentNumber),
]);

export const documentRevisionsTable = pgTable("document_revisions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  revision: text("revision").notNull(),
  status: documentStatusEnum("status").notNull().default("draft"),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  comment: text("comment"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentFilesTable = pgTable("document_files", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  fileType: text("file_type"),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tracks the next available SEQ per (project × org × discipline × docType).
// Used by both the auto-numbering fallback and the AI suggestion route.
export const documentSequencesTable = pgTable("document_sequences", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  discipline: text("discipline").notNull().default(""),
  docType: text("doc_type").notNull().default(""),
  lastSeq: integer("last_seq").notNull().default(0),
}, (t) => [
  unique("doc_seq_scope_unique").on(t.projectId, t.organizationId, t.discipline, t.docType),
]);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
export type DocumentRevision = typeof documentRevisionsTable.$inferSelect;
export type DocumentFile = typeof documentFilesTable.$inferSelect;
export type Folder = typeof foldersTable.$inferSelect;
