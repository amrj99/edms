import { pgTable, serial, text, timestamp, integer, boolean, pgEnum, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { organizationsTable } from "./organizations";

export const notificationTypeEnum = pgEnum("notification_type", [
  "document_uploaded",
  "document_approved",
  "document_rejected",
  "document_approval_request",
  "task_assigned",
  "task_overdue",
  "task_status_updated",
  "action_item_assigned",
  "correspondence_received",
  "transmittal_received",
  "transmittal_acknowledged",
  "workflow_action_required",
  "workflow_sla_reminder",
  "rfi_opened",
  "rfi_responded",
  "submittal_returned",
  "mention",
  "chat_message",
  "meeting_assigned",
  "meeting_reminder",
  "system",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
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
}, (t) => [
  index("idx_notifications_user_id").on(t.userId),
  index("idx_notifications_organization_id").on(t.organizationId),
  index("idx_notifications_is_read").on(t.isRead),
]);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
  readAt: true,
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// ─── Notification Event Types (seed table) ───────────────────────────────────
export const notificationEventTypesTable = pgTable("notification_event_types", {
  id: serial("id").primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  isSchedulerDriven: boolean("is_scheduler_driven").notNull().default(false),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  category: text("category").notNull().default("general"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NotificationEventType = typeof notificationEventTypesTable.$inferSelect;

// ─── Org Notification Settings ────────────────────────────────────────────────
export const orgNotificationSettingsTable = pgTable("org_notification_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  thresholdHours: integer("threshold_hours"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedById: integer("updated_by_id").references(() => usersTable.id),
}, (t) => [
  index("idx_org_notif_org").on(t.organizationId),
]);

export type OrgNotificationSetting = typeof orgNotificationSettingsTable.$inferSelect;

// ─── Scheduled Notifications Queue ───────────────────────────────────────────
export const scheduledNotificationsTable = pgTable("scheduled_notifications", {
  id: serial("id").primaryKey(),
  eventKey: text("event_key").notNull(),
  fireAt: timestamp("fire_at").notNull(),
  targetUserId: integer("target_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  targetEmail: text("target_email"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sched_notif_fire").on(t.fireAt),
  index("idx_sched_notif_entity").on(t.entityType, t.entityId),
]);

export type ScheduledNotification = typeof scheduledNotificationsTable.$inferSelect;

// ─── Notification Logs (delivery audit) ──────────────────────────────────────
export const notificationLogsTable = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  eventKey: text("event_key").notNull(),
  recipientUserId: integer("recipient_user_id").references(() => usersTable.id),
  recipientEmail: text("recipient_email"),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  channel: text("channel").notNull().default("email"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_notif_log_recipient").on(t.recipientUserId),
  index("idx_notif_log_entity").on(t.entityType, t.entityId),
  index("idx_notif_log_created").on(t.createdAt),
]);

export type NotificationLog = typeof notificationLogsTable.$inferSelect;
