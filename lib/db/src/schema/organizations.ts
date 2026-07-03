import { pgTable, serial, text, timestamp, integer, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
// Note: entitiesTable import would create a circular dep (entities imports organizations).
// entity_id is declared as a plain integer FK to break the cycle.
// Drizzle resolves the FK at migration time, not at schema import time.

export const organizationTypeEnum = pgEnum("organization_type", [
  "client",
  "consultant",
  "contractor",
  "subcontractor",
]);

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").unique("organizations_code_unique"),
  type: organizationTypeEnum("type").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  subscriptionTier: text("subscription_tier").default("free"),
  storageUsedMb: integer("storage_used_mb").notNull().default(0),
  corrUnreadReminderHours: integer("corr_unread_reminder_hours").notNull().default(48),
  corrNoResponseHours:     integer("corr_no_response_hours").notNull().default(72),
  corrSlaDueSoonHours:     integer("corr_sla_due_soon_hours").notNull().default(24),
  // ── Trial ───────────────────────────────────────────────────────────────────
  trialEndsAt:             timestamp("trial_ends_at"),
  // ── AI Credits ──────────────────────────────────────────────────────────────
  aiCreditsBalance:        integer("ai_credits_balance").notNull().default(0),
  aiCreditsTotalPurchased: integer("ai_credits_total_purchased").notNull().default(0),
  // Domain Model Phase 1: optional link to the real-world Entity behind this Tenant.
  // Nullable — Organization works without an Entity. Enables 1:N structurally.
  entityId: integer("entity_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;
