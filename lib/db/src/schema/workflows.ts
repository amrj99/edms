import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { documentsTable } from "./documents";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

// ─── Legacy Workflow System (unchanged — DO NOT MODIFY) ────────────────────────

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

// ─── Configurable Workflow Engine (additive — legacy tables untouched) ─────────

/**
 * wf_templates — a named workflow definition scoped to one org.
 * Each template targets a specific documentType (e.g. "Invoice", "Drawing").
 * A template can be reused across projects. Only one active template per
 * documentType per org is enforced at the application layer.
 */
export const wfTemplatesTable = pgTable("wf_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  name: text("name").notNull(),
  documentType: text("document_type").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * wf_template_stages — ordered stages within a template.
 * responsibleRole is a free-text display label (e.g. "Finance", "GM").
 * responsibleUserId is an optional specific user who owns this stage.
 * isTerminal=true means completing this stage closes the workflow as completed.
 */
export const wfTemplateStagesTable = pgTable("wf_template_stages", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").references(() => wfTemplatesTable.id, { onDelete: "cascade" }).notNull(),
  stageOrder: integer("stage_order").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  responsibleRole: text("responsible_role"),
  responsibleUserId: integer("responsible_user_id").references(() => usersTable.id),
  isTerminal: boolean("is_terminal").notNull().default(false),
  // SLA: null means no SLA for this stage (no due date, no reminder, no overdue flag)
  slaDays: integer("sla_days"),          // calendar days allowed for this stage
  reminderDays: integer("reminder_days"), // days before due to send first reminder
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * wf_instances — a live workflow attached to a single document.
 * currentStageId points to the wf_template_stages row the doc is currently at.
 * status: "active" | "completed" | "rejected" | "cancelled"
 */
export const wfInstancesTable = pgTable("wf_instances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  documentId: integer("document_id").references(() => documentsTable.id).notNull(),
  templateId: integer("template_id").references(() => wfTemplatesTable.id).notNull(),
  currentStageId: integer("current_stage_id").references(() => wfTemplateStagesTable.id),
  status: text("status").notNull().default("active"),
  initiatedById: integer("initiated_by_id").references(() => usersTable.id).notNull(),
  // SLA tracking: set when a stage with slaDays is entered; null = no SLA on current stage
  stageDueAt: timestamp("stage_due_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * wf_instance_transitions — immutable audit trail of every stage move.
 * fromStageId is null when the workflow is first started.
 * toStageId is null when the workflow is completed or cancelled.
 * action: "started" | "advanced" | "rejected" | "returned" | "completed" | "cancelled"
 */
export const wfInstanceTransitionsTable = pgTable("wf_instance_transitions", {
  id: serial("id").primaryKey(),
  instanceId: integer("instance_id").references(() => wfInstancesTable.id, { onDelete: "cascade" }).notNull(),
  fromStageId: integer("from_stage_id").references(() => wfTemplateStagesTable.id),
  toStageId: integer("to_stage_id").references(() => wfTemplateStagesTable.id),
  action: text("action").notNull(),
  actorId: integer("actor_id").references(() => usersTable.id).notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WfTemplate = typeof wfTemplatesTable.$inferSelect;
export type WfTemplateStage = typeof wfTemplateStagesTable.$inferSelect;
export type WfInstance = typeof wfInstancesTable.$inferSelect;
export type WfInstanceTransition = typeof wfInstanceTransitionsTable.$inferSelect;
