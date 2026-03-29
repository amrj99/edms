import { pgTable, serial, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const notificationTypeEnum = pgEnum("notification_type", [
  "document_uploaded",
  "document_approved",
  "document_rejected",
  "task_assigned",
  "task_overdue",
  "correspondence_received",
  "transmittal_received",
  "transmittal_acknowledged",
  "workflow_action_required",
  "rfi_opened",
  "rfi_responded",
  "submittal_returned",
  "mention",
  "chat_message",
  "meeting_assigned",
  "system",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  projectId: integer("project_id").references(() => projectsTable.id),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  actionUrl: text("action_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
  readAt: true,
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
