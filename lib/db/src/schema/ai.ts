import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, pgEnum, unique, index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

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
  // organizationId is part of the unique key: same entity can have per-org cache entries
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

export type AiModule = typeof aiModuleEnum.enumValues[number];
export type AiSettings = typeof aiSettingsTable.$inferSelect;
export type AiCache = typeof aiCacheTable.$inferSelect;
