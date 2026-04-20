import {
  pgTable, serial, text, integer, boolean, timestamp, index, unique, primaryKey,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const departmentsTable = pgTable("departments", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  description:    text("description"),
  parentId:       integer("parent_id"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("departments_org_code_unique").on(t.organizationId, t.code),
  index("idx_departments_org").on(t.organizationId),
]);

export const userDepartmentsTable = pgTable("user_departments", {
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").notNull().references(() => departmentsTable.id, { onDelete: "cascade" }),
  isPrimary:    boolean("is_primary").notNull().default(false),
  joinedAt:     timestamp("joined_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.departmentId] }),
  index("idx_user_departments_user").on(t.userId),
  index("idx_user_departments_dept").on(t.departmentId),
]);

export type Department    = typeof departmentsTable.$inferSelect;
export type UserDepartment = typeof userDepartmentsTable.$inferSelect;
