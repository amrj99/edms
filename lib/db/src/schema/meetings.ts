import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const meetingStatusEnum = pgEnum("meeting_status", [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  organizedById: integer("organized_by_id").references(() => usersTable.id).notNull(),
  status: meetingStatusEnum("status").notNull().default("scheduled"),
  location: text("location"),
  meetingDate: timestamp("meeting_date").notNull(),
  duration: integer("duration"), // minutes
  agenda: text("agenda"),
  minutes: text("minutes"),
  referenceNumber: text("reference_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const meetingAttendeesTable = pgTable("meeting_attendees", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").references(() => meetingsTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id),
  name: text("name"), // for external attendees without user accounts
  email: text("email"),
  attended: boolean("attended").notNull().default(false),
});

export const meetingActionItemsTable = pgTable("meeting_action_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").references(() => meetingsTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  assignedToName: text("assigned_to_name"), // for external attendees
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("open"), // open, in_progress, done
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const meetingAttachmentsTable = pgTable("meeting_attachments", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").references(() => meetingsTable.id, { onDelete: "cascade" }).notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertMeetingSchema = createInsertSchema(meetingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetingsTable.$inferSelect;
