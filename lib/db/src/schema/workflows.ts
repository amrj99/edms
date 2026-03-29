import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { documentsTable } from "./documents";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const workflowStepEnum = pgEnum("workflow_step", [
  "uploaded",
  "under_review",
  "approved",
  "issued",
  "rejected",
]);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "active",
  "completed",
  "rejected",
  "cancelled",
]);

export const workflowActionEnum = pgEnum("workflow_action", [
  "approved",
  "approved_with_comments",
  "for_revision",
  "rejected",
  "commented",
  "submitted",
]);

export const workflowsTable = pgTable("workflows", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  currentStep: workflowStepEnum("current_step").notNull().default("uploaded"),
  status: workflowStatusEnum("status").notNull().default("active"),
  initiatedById: integer("initiated_by_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workflowStepsTable = pgTable("workflow_steps", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflowsTable.id).notNull(),
  step: text("step").notNull(),
  action: workflowActionEnum("action").notNull(),
  comment: text("comment"),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkflowSchema = createInsertSchema(workflowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflowsTable.$inferSelect;
export type WorkflowStep = typeof workflowStepsTable.$inferSelect;
