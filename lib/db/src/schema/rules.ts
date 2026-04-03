import { pgTable, serial, text, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
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
export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  appliesTo: text("applies_to").notNull().default("both"), // "document" | "correspondence" | "both"
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

export const insertRuleSchema = createInsertSchema(rulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Rule = typeof rulesTable.$inferSelect;
export type InsertRule = z.infer<typeof insertRuleSchema>;
