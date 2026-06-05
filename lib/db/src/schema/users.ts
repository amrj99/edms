import { pgTable, serial, text, timestamp, integer, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const userRoleEnum = pgEnum("user_role", [
  "system_owner",
  "admin",
  "project_manager",
  "document_controller",
  "reviewer",
  "member",
  "viewer",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  department: text("department"),
  isActive: boolean("is_active").notNull().default(true),
  isReadOnlyOverride: boolean("is_read_only_override").notNull().default(false),
  acceptedTermsAt: timestamp("accepted_terms_at"),
  acceptedTermsVersion: text("accepted_terms_version"),
  passwordChangedAt: timestamp("password_changed_at"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationTokenExpiresAt: timestamp("email_verification_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_users_organization_id").on(t.organizationId),
  index("idx_users_email").on(t.email),
  index("idx_users_role").on(t.role),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
