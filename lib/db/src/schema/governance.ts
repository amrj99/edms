import { pgTable, serial, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { userRoleEnum } from "./users";

// ─── Delegations ─────────────────────────────────────────────────────────────
// A delegation allows one user (toUser) to act on behalf of another (fromUser)
// for a given time period. Scope: org-wide (projectId = null) or project-specific.

export const delegationsTable = pgTable("delegations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  fromUserId: integer("from_user_id").references(() => usersTable.id).notNull(),
  toUserId: integer("to_user_id").references(() => usersTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id).notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id),
}, (t) => [
  index("idx_delegations_org_id").on(t.organizationId),
  index("idx_delegations_from_user_id").on(t.fromUserId),
  index("idx_delegations_to_user_id").on(t.toUserId),
  index("idx_delegations_project_id").on(t.projectId),
  index("idx_delegations_expires_at").on(t.expiresAt),
]);

// ─── Project Role Overrides ───────────────────────────────────────────────────
// A temporary project-level role elevation for a specific user.
// Does not change the user's org-level role — only their effective role
// within the context of the specified project, until expiresAt.

export const projectRoleOverridesTable = pgTable("project_role_overrides", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  roleOverride: userRoleEnum("role_override").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id).notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id),
}, (t) => [
  index("idx_proj_role_overrides_org_id").on(t.organizationId),
  index("idx_proj_role_overrides_project_id").on(t.projectId),
  index("idx_proj_role_overrides_user_id").on(t.userId),
  index("idx_proj_role_overrides_expires_at").on(t.expiresAt),
]);

export const insertDelegationSchema = createInsertSchema(delegationsTable).omit({
  id: true,
  grantedAt: true,
  revokedAt: true,
  revokedByUserId: true,
});

export const insertProjectRoleOverrideSchema = createInsertSchema(projectRoleOverridesTable).omit({
  id: true,
  grantedAt: true,
  revokedAt: true,
  revokedByUserId: true,
});

export type Delegation = typeof delegationsTable.$inferSelect;
export type InsertDelegation = z.infer<typeof insertDelegationSchema>;
export type ProjectRoleOverride = typeof projectRoleOverridesTable.$inferSelect;
export type InsertProjectRoleOverride = z.infer<typeof insertProjectRoleOverrideSchema>;
