import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const correspondenceTypeEnum = pgEnum("correspondence_type", [
  "transmittal",
  "letter",
  "memo",
  "rfi",
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
]);

export const correspondenceTable = pgTable("correspondence", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  type: correspondenceTypeEnum("type").notNull(),
  folder: correspondenceFolderEnum("folder").notNull().default("draft"),
  body: text("body"),
  fromUserId: integer("from_user_id").references(() => usersTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  parentId: integer("parent_id"),
  referenceNumber: text("reference_number"),
  status: correspondenceStatusEnum("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const correspondenceRecipientsTable = pgTable("correspondence_recipients", {
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

export const insertCorrespondenceSchema = createInsertSchema(correspondenceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCorrespondence = z.infer<typeof insertCorrespondenceSchema>;
export type Correspondence = typeof correspondenceTable.$inferSelect;
