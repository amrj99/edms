import { pgTable, serial, text, timestamp, integer, pgEnum, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

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
  "closed",
  "overdue",
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
  isRead: boolean("is_read").notNull().default(false),
  shareToken: text("share_token"),
  shareExpiresAt: timestamp("share_expires_at"),
  sharePasswordHash: text("share_password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const correspondenceRecipientsTable = pgTable("correspondence_recipients", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
});

export const correspondenceCcTable = pgTable("correspondence_cc", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
});

export const correspondenceAttachmentsTable = pgTable("correspondence_attachments", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").references(() => correspondenceTable.id).notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

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

export const insertCorrespondenceSchema = createInsertSchema(correspondenceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCorrespondence = z.infer<typeof insertCorrespondenceSchema>;
export type Correspondence = typeof correspondenceTable.$inferSelect;
export type CorrespondenceSequence = typeof correspondenceSequencesTable.$inferSelect;
