import { pgTable, serial, text, timestamp, integer, pgEnum, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { documentsTable } from "./documents";

export const correspondenceTypeEnum = pgEnum("correspondence_type", [
  "transmittal",
  "letter",
  "memo",
  "rfi",
  "notice",
  "email",
  "internal",
  "submittal",
  "ncr",
  "technical_query",
  "inspection",
]);

export const correspondenceFolderEnum = pgEnum("correspondence_folder", [
  "inbox",
  "sent",
  "draft",
  "archive",
]);

export const correspondenceStatusEnum = pgEnum("correspondence_status", [
  "draft",
  "sent",
  "read",
  "responded",
  "under_review",
  "closed",
  "overdue",
  "recalled",
]);

export const correspondencePriorityEnum = pgEnum("correspondence_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const correspondenceTable = pgTable("correspondence", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  type: correspondenceTypeEnum("type").notNull(),
  folder: correspondenceFolderEnum("folder").notNull().default("draft"),
  body: text("body"),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  fromUserId: integer("from_user_id").references(() => usersTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  scope: text("scope").notNull().default("project"),
  parentId: integer("parent_id"),
  referenceNumber: text("reference_number"),
  status: correspondenceStatusEnum("status").notNull().default("draft"),
  priority: correspondencePriorityEnum("priority").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  linkedDocumentId: integer("linked_document_id"),
  packageId: integer("package_id"),
  dueDate: timestamp("due_date"),
  sentAt: timestamp("sent_at"),
  closedAt: timestamp("closed_at"),
  recalledAt: timestamp("recalled_at"),
  recalledById: integer("recalled_by_id").references(() => usersTable.id),
  direction: text("direction", { enum: ["incoming", "outgoing"] }),
  requiresResponse: boolean("requires_response").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  firstReadAt: timestamp("first_read_at"),
  shareToken: text("share_token"),
  shareExpiresAt: timestamp("share_expires_at"),
  sharePasswordHash: text("share_password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // I-03: main list query — WHERE organization_id + project_id ORDER BY updated_at DESC
  index("idx_correspondence_org_project_updated").on(t.organizationId, t.projectId, t.updatedAt),
]);

export const correspondenceRecipientsTable = pgTable("correspondence_recipients", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
}, (t) => [
  // I-04: enrichCorrespondence batch lookup — WHERE correspondence_id IN (...)
  index("idx_corr_recipients_corr_id").on(t.correspondenceId),
  // I-05: mail-model received lookup — WHERE user_id = $userId
  index("idx_corr_recipients_user_id").on(t.userId),
]);

export const correspondenceCcTable = pgTable("correspondence_cc", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
}, (t) => [
  // I-06: enrichCorrespondence batch lookup — WHERE correspondence_id IN (...)
  index("idx_corr_cc_corr_id").on(t.correspondenceId),
  // I-07: mail-model CC lookup — WHERE user_id = $userId
  index("idx_corr_cc_user_id").on(t.userId),
]);

export const correspondenceAttachmentsTable = pgTable("correspondence_attachments", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (t) => [
  // I-08: enrichCorrespondence batch lookup — WHERE correspondence_id IN (...)
  index("idx_corr_attachments_corr_id").on(t.correspondenceId),
]);

// ─── Correspondence numbering sequences ───────────────────────────────────────
export const correspondenceSequencesTable = pgTable(
  "correspondence_sequences",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
    scope: text("scope").notNull(),
    projectId: integer("project_id").references(() => projectsTable.id),
    year: integer("year").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("correspondence_seq_uniq").on(t.organizationId, t.scope, t.projectId, t.year),
  ]
);

// ─── Correspondence ↔ Document many-to-many join ─────────────────────────────
// A single correspondence item may reference multiple documents, and a document
// may appear in multiple correspondence items. This replaces the old single-FK
// `linkedDocumentId` field on the correspondence table for new associations.
// The legacy field is retained for backward compatibility with existing data.
export const correspondenceDocumentsTable = pgTable(
  "correspondence_documents",
  {
    id:               serial("id").primaryKey(),
    correspondenceId: integer("correspondence_id")
                        .references(() => correspondenceTable.id, { onDelete: "cascade" })
                        .notNull(),
    documentId:       integer("document_id")
                        .references(() => documentsTable.id, { onDelete: "cascade" })
                        .notNull(),
    createdAt:        timestamp("created_at").defaultNow().notNull(),
    createdById:      integer("created_by_id").references(() => usersTable.id),
    note:             text("note"),
  },
  (t) => [
    uniqueIndex("correspondence_documents_uniq").on(t.correspondenceId, t.documentId),
  ]
);

export const insertCorrespondenceSchema = createInsertSchema(correspondenceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCorrespondence = z.infer<typeof insertCorrespondenceSchema>;
export type Correspondence = typeof correspondenceTable.$inferSelect;
export type CorrespondenceSequence = typeof correspondenceSequencesTable.$inferSelect;
export type CorrespondenceDocument = typeof correspondenceDocumentsTable.$inferSelect;
