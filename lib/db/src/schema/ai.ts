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
 */
export const aiAnalysisTable = pgTable("ai_analysis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  entityRevision: text("entity_revision"),
  analysisType: text("analysis_type").notNull(),
  result: jsonb("result").notNull(),
  provider: text("provider"),
  model: text("model"),
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  triggeredBy: integer("triggered_by").references(() => usersTable.id),
  isLatest: boolean("is_latest").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ai_analysis_entity").on(t.entityType, t.entityId),
  index("idx_ai_analysis_org").on(t.organizationId),
  index("idx_ai_analysis_latest").on(t.entityType, t.entityId, t.analysisType, t.isLatest),
  index("idx_ai_analysis_org_type_latest").on(t.organizationId, t.entityType, t.isLatest),
]);

/**
 * ai_models — admin-managed model catalogue.
 * Admins can update model names via the Admin → AI Settings panel without code changes.
 * Falls back to hardcoded provider defaults when table is empty for a given provider.
 */
export const aiModelsTable = pgTable("ai_models", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),          // "cloudflare" | "groq" | "openrouter" | ...
  modelId: text("model_id").notNull(),            // actual model identifier sent to the API
  displayName: text("display_name").notNull(),    // human-readable name shown in admin UI
  tierMinimum: text("tier_minimum").notNull().default("free"),  // "free" | "starter" | "basic" | "professional" | "enterprise"
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("ai_models_provider_model").on(t.provider, t.modelId),
  index("idx_ai_models_provider").on(t.provider),
  index("idx_ai_models_active").on(t.isActive),
]);

export type AiModule = typeof aiModuleEnum.enumValues[number];
export type AiSettings = typeof aiSettingsTable.$inferSelect;
export type AiCache = typeof aiCacheTable.$inferSelect;
export type AiAnalysis = typeof aiAnalysisTable.$inferSelect;
export type AiModel = typeof aiModelsTable.$inferSelect;
export type InsertAiModel = typeof aiModelsTable.$inferInsert;
