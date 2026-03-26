import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { documentsTable } from "./documents";

export const transmittalStatusEnum = pgEnum("transmittal_status", [
  "draft",
  "sent",
  "acknowledged",
  "rejected",
]);

export const transmittalsTable = pgTable("transmittals", {
  id: serial("id").primaryKey(),
  transmittalNumber: text("transmittal_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  status: transmittalStatusEnum("status").notNull().default("draft"),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  toUserId: integer("to_user_id").references(() => usersTable.id),
  toExternal: text("to_external"),
  sentAt: timestamp("sent_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  dueDate: timestamp("due_date"),
  purpose: text("purpose").notNull().default("for_information"),
  shareToken: text("share_token"),
  shareExpiresAt: timestamp("share_expires_at"),
  sharePasswordHash: text("share_password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transmittalItemsTable = pgTable("transmittal_items", {
  id: serial("id").primaryKey(),
  transmittalId: integer("transmittal_id").references(() => transmittalsTable.id).notNull(),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  revision: text("revision"),
  copies: integer("copies").default(1),
  purpose: text("purpose"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const insertTransmittalSchema = createInsertSchema(transmittalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTransmittalItemSchema = createInsertSchema(transmittalItemsTable).omit({
  id: true,
  addedAt: true,
});

export type Transmittal = typeof transmittalsTable.$inferSelect;
export type TransmittalItem = typeof transmittalItemsTable.$inferSelect;
export type InsertTransmittal = z.infer<typeof insertTransmittalSchema>;
