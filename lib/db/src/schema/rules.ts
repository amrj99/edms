import { pgTable, serial, text, timestamp, integer, jsonb, boolean, index, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * Rules Engine — admin-configurable automation rules that run on
 * document upload and correspondence creation.
 *
 * Conditions (all optional, ANDed together):
 *   documentType, discipline, projectId, subjectContains, senderUserId
 *
 * Actions (array, all execute when rule matches):
 *   assign_user    { userId }
 *   assign_team    { teamId }        (future: team concept)
 *   send_notification { message, userIds? }
 *
 * appliesTo: "document" | "correspondence" | "both"
 */

export const ruleAppliesToEnum = pgEnum("rule_applies_to", [
  "document",
  "correspondence",
  "both",
]);

export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  appliesTo: ruleAppliesToEnum("applies_to").notNull().default("both"),
  conditions: jsonb("conditions").notNull().default({}),
  // { documentType?, discipline?, projectId?, subjectContains?, senderUserId? }
  actions: jsonb("actions").notNull().default([]),
  // [{ type: "assign_user"|"assign_team"|"send_notification", config: {...} }]
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_rules_organization_id").on(t.organizationId),
  index("idx_rules_is_enabled").on(t.isEnabled),
]);

// ─── Rule Execution Logs — per-rule audit trail ────────────────────────────────

export const ruleExecutionLogsTable = pgTable("rule_execution_logs", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").references(() => rulesTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  entityType: text("entity_type").notNull(),        // "document" | "correspondence"
  entityId: integer("entity_id"),                   // id of the triggering entity
  actionsTaken: jsonb("actions_taken").notNull().default([]), // ["assign_user:5", "send_notification:3,7"]
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (t) => [
  index("idx_rule_exec_logs_rule_id").on(t.ruleId),
  index("idx_rule_exec_logs_organization_id").on(t.organizationId),
  index("idx_rule_exec_logs_executed_at").on(t.executedAt),
]);

export const insertRuleSchema = createInsertSchema(rulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Rule = typeof rulesTable.$inferSelect;
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type RuleExecutionLog = typeof ruleExecutionLogsTable.$inferSelect;
