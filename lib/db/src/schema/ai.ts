import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, pgEnum, unique, index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const aiModuleEnum = pgEnum("ai_module", [
  "documents",
  "correspondence",
  "tasks",
  "search",
  "notifications",
  "meetings",
  "inspections",
]);

export const aiSettingsTable = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  module: aiModuleEnum("module").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("ai_settings_org_module").on(t.organizationId, t.module),
]);

export const aiCacheTable = pgTable("ai_cache", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  analysisType: text("analysis_type").notNull(),
  result: jsonb("result").notNull(),
  model: text("model").notNull().default("gpt-4o-mini"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("ai_cache_entity_analysis").on(t.organizationId, t.entityType, t.entityId, t.analysisType),
  index("idx_ai_cache_organization_id").on(t.organizationId),
]);

export const aiLogsTable = pgTable("ai_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  userId: integer("user_id"),
  module: aiModuleEnum("module").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  provider: text("provider"),
  model: text("model"),
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ai_logs_organization_id").on(t.organizationId),
  index("idx_ai_logs_user_id").on(t.userId),
  index("idx_ai_logs_module").on(t.module),
]);

/**
 * ai_analysis — permanent, append-only record of every AI analysis result.
 *
 * Design principles:
 * - No expiresAt: records are never automatically deleted.
 * - isLatest=true marks the most recent analysis for a given entity+revision+analysisType.
 * - entityRevision tracks document revision (e.g. "A", "B", "01") so analyses are
 *   independent across revisions. null for non-versioned entities (correspondence, tasks).
 * - No FK to documents/correspondence/tasks — fully decoupled from domain tables.
 *   entityType + entityId is the loose reference (same pattern as ai_cache/ai_logs).
 * - organizationId provides multi-tenant isolation.
 */
export const aiAnalysisTable = pgTable("ai_analysis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  entityType: text("entity_type").notNull(),       // "document" | "correspondence" | "task" | ...
  entityId: integer("entity_id").notNull(),
  entityRevision: text("entity_revision"),         // "A", "B", "01" — null for unversioned
  analysisType: text("analysis_type").notNull(),   // "analyze" | "classify" | "suggest_procedure" | ...
  result: jsonb("result").notNull(),               // full AI response object
  provider: text("provider"),                      // which AI provider was used
  model: text("model"),                            // which model was used
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  triggeredBy: integer("triggered_by").references(() => usersTable.id), // who requested it
  isLatest: boolean("is_latest").notNull().default(true), // false on superseded rows
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ai_analysis_entity").on(t.entityType, t.entityId),
  index("idx_ai_analysis_org").on(t.organizationId),
  index("idx_ai_analysis_latest").on(t.entityType, t.entityId, t.analysisType, t.isLatest),
  index("idx_ai_analysis_org_type_latest").on(t.organizationId, t.entityType, t.isLatest),
]);

export type AiModule = typeof aiModuleEnum.enumValues[number];
export type AiSettings = typeof aiSettingsTable.$inferSelect;
export type AiCache = typeof aiCacheTable.$inferSelect;
export type AiAnalysis = typeof aiAnalysisTable.$inferSelect;
