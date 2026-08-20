import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const refreshTokensTable = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  token: text("token").notNull().unique(),
  // timestamptz: absolute instants — unambiguous regardless of DB/session timezone
  // (the app writes/compares JS Dates; a plain `timestamp` skews on non-UTC clusters).
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),        // absolute session end
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(), // idle clock
  familyId: text("family_id"),                          // rotation chain id — reuse of a revoked member = theft
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokensTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
export type RefreshToken = typeof refreshTokensTable.$inferSelect;
