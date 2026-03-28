import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const deliverableStatusEnum = pgEnum("deliverable_status", [
  "not_started", "in_progress", "submitted", "approved", "rejected", "on_hold", "closed",
]);

export const deliverablesTable = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  deliverableId: text("deliverable_id").notNull(),
  title: text("title").notNull(),
  type: text("type"),
  plannedDate: timestamp("planned_date"),
  actualDate: timestamp("actual_date"),
  status: deliverableStatusEnum("status").notNull().default("not_started"),
  responsible: text("responsible"),
  linkedDocumentId: integer("linked_document_id"),
  remarks: text("remarks"),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
