import { pgTable, serial, text, timestamp, integer, boolean, pgEnum, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { userRoleEnum } from "./users";
import { entitiesTable } from "./entities";

// ─── Party Model — Single Source of Truth ────────────────────────────────────
// TEXT columns (not pgEnum) — new values added by updating CHECK constraint only,
// no ALTER TYPE ADD VALUE complexity. See MIGRATION_GOVERNANCE.md.

export const PARTY_ROLES = ["observer", "contributor"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const COLLABORATION_MODES = ["org_only", "parties"] as const;
export type CollaborationMode = (typeof COLLABORATION_MODES)[number];

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
  visibleOnFree: boolean("visible_on_free").notNull().default(true),
  collaborationMode: text("collaboration_mode").notNull().default("org_only"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_projects_organization_id").on(t.organizationId),
  index("idx_projects_status").on(t.status),
  check("chk_collaboration_mode", sql`${t.collaborationMode} IN ('org_only', 'parties')`),
]);

export const projectMembersTable = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (t) => [
  index("idx_project_members_project_id").on(t.projectId),
  index("idx_project_members_user_id").on(t.userId),
]);

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

export const insertProjectSchema = createInsertSchema(projectsTable, {
  collaborationMode: z.enum(COLLABORATION_MODES).default("org_only"),
}).omit({
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

// ─── Project Participants (Phase 2 — Entity Directory) ────────────────────────

export const participantRoleEnum = pgEnum("participant_role", [
  "owner",
  "consultant",
  "main_contractor",
  "sub_contractor",
  "supplier",
  "authority",
  "other",
]);

// Links an Entity to a Project with a participation role.
// UNIQUE (project_id, entity_id): one Entity → one role per Project.
// Multi-role participation is deferred; see DOMAIN_MODEL.md DM-08.
// No authorization implications — purely a directory annotation in Phase 2.
export const projectParticipantsTable = pgTable("project_participants", {
  id:        serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull(),
  entityId:  integer("entity_id").references(() => entitiesTable.id, { onDelete: "cascade" }).notNull(),
  role:      participantRoleEnum("role").notNull(),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pp_project_id").on(t.projectId),
  index("idx_pp_entity_id").on(t.entityId),
  unique("uq_project_entity").on(t.projectId, t.entityId),
]);

export const insertProjectParticipantSchema = createInsertSchema(projectParticipantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProjectParticipant = typeof projectParticipantsTable.$inferSelect;
export type InsertProjectParticipant = z.infer<typeof insertProjectParticipantSchema>;

// ─── Project Parties (Phase 5 — Party Model Minimum) ─────────────────────────
// Links an Organization to a Project with a party role and access ceiling.
// Uses soft delete (removedAt/removedById) to preserve audit trail.
// Authorization gate: canAccessProjectAsParty() in lib/party-access.ts.
// See ADR-011 for why this is separate from orgScopedWhere.

export const projectPartiesTable = pgTable("project_parties", {
  id:             serial("id").primaryKey(),
  projectId:      integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizationsTable.id).notNull(),
  partyRole:      text("party_role").notNull(),
  addedById:      integer("added_by_id").references(() => usersTable.id).notNull(),
  addedAt:        timestamp("added_at").defaultNow().notNull(),
  removedAt:      timestamp("removed_at"),
  removedById:    integer("removed_by_id").references(() => usersTable.id),
}, (t) => [
  check("chk_party_role", sql`${t.partyRole} IN ('observer', 'contributor')`),
  unique("uq_project_party").on(t.projectId, t.organizationId),
  index("idx_project_parties_project_id").on(t.projectId),
  index("idx_project_parties_org_id").on(t.organizationId),
]);

export const insertProjectPartySchema = createInsertSchema(projectPartiesTable, {
  partyRole: z.enum(PARTY_ROLES),
}).omit({
  id: true,
  addedAt: true,
  removedAt: true,
  removedById: true,
});

export type ProjectParty = typeof projectPartiesTable.$inferSelect;
export type InsertProjectParty = z.infer<typeof insertProjectPartySchema>;
