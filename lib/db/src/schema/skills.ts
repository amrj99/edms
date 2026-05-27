import {
  pgTable, serial, text, timestamp, integer, jsonb, boolean, pgEnum, index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const skillTriggerTypeEnum = pgEnum("skill_trigger_type", [
  "document_uploaded",
  "task_completed",
  "project_status_changed",
  "scheduled_daily",
  "scheduled_weekly",
  "scheduled_interval",
]);

export const skillHandlerTypeEnum = pgEnum("skill_handler_type", [
  "send_notification",
  "send_email",
  "change_status",
  "generate_report",
]);

export const skillExecutionStatusEnum = pgEnum("skill_execution_status", [
  "pending",
  "running",
  "success",
  "failed",
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const skillDefinitionsTable = pgTable("skill_definitions", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  name:           text("name").notNull(),
  description:    text("description"),
  triggerType:    skillTriggerTypeEnum("trigger_type").notNull(),
  handlerType:    skillHandlerTypeEnum("handler_type").notNull(),
  config:         jsonb("config").notNull().default({}),
  isEnabled:      boolean("is_enabled").notNull().default(false),
  createdById:    integer("created_by_id").references(() => usersTable.id),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const skillExecutionsTable = pgTable("skill_executions", {
  id:               serial("id").primaryKey(),
  skillId:          integer("skill_id").references(() => skillDefinitionsTable.id).notNull(),
  organizationId:   integer("organization_id").notNull(),
  triggeredByType:  text("triggered_by_type").notNull().default("cron"), // 'cron' | 'event' | 'manual'
  triggeredById:    integer("triggered_by_id"),
  status:           skillExecutionStatusEnum("status").notNull().default("pending"),
  result:           jsonb("result"),
  errorMessage:     text("error_message"),
  durationMs:       integer("duration_ms"),
  executedAt:       timestamp("executed_at").notNull().defaultNow(),
}, (t) => [
  index("idx_skill_executions_skill_id").on(t.skillId),
  index("idx_skill_executions_org_id").on(t.organizationId),
  index("idx_skill_executions_executed_at").on(t.executedAt),
  index("idx_skill_executions_status").on(t.status),
]);

// ─── Zod / types ──────────────────────────────────────────────────────────────

export const insertSkillDefinitionSchema = createInsertSchema(skillDefinitionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
}).extend({
  config: z.record(z.string(), z.unknown()).default({}),
});

export type SkillDefinition = typeof skillDefinitionsTable.$inferSelect;
export type InsertSkillDefinition = typeof skillDefinitionsTable.$inferInsert;
export type SkillExecution  = typeof skillExecutionsTable.$inferSelect;
