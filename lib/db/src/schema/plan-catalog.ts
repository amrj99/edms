/**
 * Plan Catalog Schema — Phase 2 foundation (shadow mode, no behavior change yet).
 *
 * Three new tables added as the DB foundation for a unified plan/quota system:
 *
 *   plans               — canonical plan definitions, seeded from lib/plans.ts at startup.
 *                         Replaces the hardcoded PLANS array in future phases.
 *
 *   org_feature_overrides — per-org feature flag overrides, stored separately from
 *                           org_config.modules. Allows enabling/disabling individual
 *                           features independently of the plan's defaults.
 *
 *   org_quota_overrides — per-org quota overrides. Allows giving an org different limits
 *                         (storage, users, migration files, AI calls) than their plan's
 *                         defaults without changing their plan tier.
 *
 * CURRENT STATUS: Shadow mode only.
 *   - Tables are created and seeded at startup.
 *   - getResolvedPlan() reads them and logs mismatches.
 *   - No existing route or middleware reads from these tables for enforcement yet.
 *   - No old columns removed. No production behavior changed.
 */

import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, unique,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// ─── plans ────────────────────────────────────────────────────────────────────
// Canonical plan catalog. Seeded from lib/plans.ts at startup (upsert).
// Becomes the SSOT for plan definitions in Phase 3+.
// Currently read only by getResolvedPlan() for shadow-mode mismatch logging.

export const plansTable = pgTable("plans", {
  id:                 serial("id").primaryKey(),
  planId:             text("plan_id").unique().notNull(),        // "free" | "starter" | "basic" | "professional" | "enterprise"
  name:               text("name").notNull(),
  description:        text("description"),
  priceAed:           integer("price_aed").notNull().default(0), // price per month in AED (integer)
  currency:           text("currency").notNull().default("aed"),
  interval:           text("interval").notNull().default("month"),
  maxUsers:           integer("max_users"),                      // null = unlimited
  storageMb:          integer("storage_mb").notNull().default(0),
  migrationMaxFiles:  integer("migration_max_files").notNull().default(0), // 0 = wizard disabled
  rateLimitRpm:       integer("rate_limit_rpm"),                 // null = unlimited
  features:           jsonb("features").notNull().default([]),   // string[] — marketing copy
  stripePriceEnv:     text("stripe_price_env"),                  // env var name holding Stripe price ID
  isActive:           boolean("is_active").notNull().default(true),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});

// ─── org_feature_overrides ────────────────────────────────────────────────────
// Per-org feature overrides. Each row enables or disables one feature for one org,
// overriding what the org's plan would normally allow.
//
// featureKey values (current):
//   "chat" | "registers" | "deliverables" | "dashboard" | "notifications"
//   "ai" | "migration_wizard"
//
// Unique constraint: one row per (org, feature). Upsert to change.

export const orgFeatureOverridesTable = pgTable("org_feature_overrides", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id")
                      .references(() => organizationsTable.id, { onDelete: "cascade" })
                      .notNull(),
  featureKey:       text("feature_key").notNull(),
  isEnabled:        boolean("is_enabled").notNull(),
  reason:           text("reason"),
  grantedByUserId:  integer("granted_by_user_id").references(() => usersTable.id),
  expiresAt:        timestamp("expires_at"),         // null = permanent
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("org_feature_overrides_org_feature_uq").on(t.organizationId, t.featureKey),
]);

// ─── org_quota_overrides ──────────────────────────────────────────────────────
// Per-org quota overrides. Each row overrides one quota limit for one org.
//
// quotaKey values (current):
//   "storage_mb"          — max storage in MB    (-1 = unlimited)
//   "max_users"           — max user seats       (-1 = unlimited)
//   "migration_max_files" — max files per import (-1 = unlimited, 0 = disabled)
//   "ai_daily_calls"      — max AI calls/day     (0 = unlimited)
//   "ai_monthly_tokens"   — max AI tokens/month  (0 = unlimited)
//   "rate_limit_rpm"      — max requests/minute  (-1 = unlimited)
//
// Unique constraint: one row per (org, quota). Upsert to change.

export const orgQuotaOverridesTable = pgTable("org_quota_overrides", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id")
                      .references(() => organizationsTable.id, { onDelete: "cascade" })
                      .notNull(),
  quotaKey:         text("quota_key").notNull(),
  quotaValue:       integer("quota_value").notNull(), // -1 = unlimited, 0 = disabled
  reason:           text("reason"),
  grantedByUserId:  integer("granted_by_user_id").references(() => usersTable.id),
  expiresAt:        timestamp("expires_at"),           // null = permanent
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("org_quota_overrides_org_quota_uq").on(t.organizationId, t.quotaKey),
]);

export type Plan               = typeof plansTable.$inferSelect;
export type OrgFeatureOverride = typeof orgFeatureOverridesTable.$inferSelect;
export type OrgQuotaOverride   = typeof orgQuotaOverridesTable.$inferSelect;
