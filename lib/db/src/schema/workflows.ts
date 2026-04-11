import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { documentsTable } from "./documents";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

// ─── Configurable Workflow Engine ─────────────────────────────────────────────

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
  slaDays: integer("sla_days"),
  reminderDays: integer("reminder_days"),
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
