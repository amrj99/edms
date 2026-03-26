import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, pgEnum, unique,
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
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  analysisType: text("analysis_type").notNull(),
  result: jsonb("result").notNull(),
  model: text("model").notNull().default("gpt-5-mini"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("ai_cache_entity_analysis").on(t.entityType, t.entityId, t.analysisType),
]);

export const aiLogsTable = pgTable("ai_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  module: aiModuleEnum("module").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiModule = typeof aiModuleEnum.enumValues[number];
export type AiSettings = typeof aiSettingsTable.$inferSelect;
export type AiCache = typeof aiCacheTable.$inferSelect;
