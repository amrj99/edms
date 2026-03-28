import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export interface NotificationPref { inApp: boolean; email: boolean; }
export type NotificationPrefs = Partial<Record<string, NotificationPref>>;

export const userPreferencesTable = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  dashboardWidgets: jsonb("dashboard_widgets").$type<string[]>(),
  dashboardLayout: jsonb("dashboard_layout").$type<string[]>(),
  savedFilters: jsonb("saved_filters").$type<any[]>(),
  columnPrefs: jsonb("column_prefs").$type<Record<string, string[]>>(),
  notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
