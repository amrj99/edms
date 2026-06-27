import { pgTable, serial, text, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const taskSourceTypeEnum = pgEnum("task_source_type", [
  "manual",
  "workflow",
  "correspondence",
  "document",
]);

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  sourceType: taskSourceTypeEnum("source_type").notNull().default("manual"),
  sourceId: integer("source_id"),
  dueDate: timestamp("due_date"),
  assignedAt: timestamp("assigned_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tasks_organization_id").on(t.organizationId),
  index("idx_tasks_project_id").on(t.projectId),
  index("idx_tasks_assigned_to_id").on(t.assignedToId),
]);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
