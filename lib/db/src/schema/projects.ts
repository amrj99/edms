import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { userRoleEnum } from "./users";

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("active"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectMembersTable = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const packagesTable = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({
  id: true,
  joinedAt: true,
});

export const insertPackageSchema = createInsertSchema(packagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
export type Package = typeof packagesTable.$inferSelect;
