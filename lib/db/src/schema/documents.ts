import { pgTable, serial, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

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
]);

export const foldersTable = pgTable("folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const documentRevisionsTable = pgTable("document_revisions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  revision: text("revision").notNull(),
  status: text("status").notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  comment: text("comment"),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  reviewDecision: text("review_decision"),
  reviewerName: text("reviewer_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Document Files (one-to-many file attachments per document) ───────────────

export const documentFilesTable = pgTable("document_files", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  fileType: text("file_type"), // MIME type
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDocumentFileSchema = createInsertSchema(documentFilesTable).omit({
  id: true,
  createdAt: true,
});

export type DocumentFile = typeof documentFilesTable.$inferSelect;
export type InsertDocumentFile = z.infer<typeof insertDocumentFileSchema>;

// ─────────────────────────────────────────────────────────────────────────────

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFolderSchema = createInsertSchema(foldersTable).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentRevisionSchema = createInsertSchema(documentRevisionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
export type Folder = typeof foldersTable.$inferSelect;
export type DocumentRevision = typeof documentRevisionsTable.$inferSelect;
