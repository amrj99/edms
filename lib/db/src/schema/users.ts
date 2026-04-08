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
  acceptedTermsAt: timestamp("accepted_terms_at"),
  acceptedTermsVersion: text("accepted_terms_version"),
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
