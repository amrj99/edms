import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { organizationsTable } from "./organizations";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  entityTitle: text("entity_title"),
  details: jsonb("details").default({}),
  projectId: integer("project_id").references(() => projectsTable.id),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // ── Added by 0010_audit_schema.sql ───────────────────────────────────────
  // Structured state capture for update/delete events.
  // All nullable — existing rows and existing call sites are unaffected.
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  actorRole: text("actor_role"),
  userAgent: text("user_agent"),
}, (t) => [
  index("idx_audit_logs_organization_id").on(t.organizationId),
  index("idx_audit_logs_project_id").on(t.projectId),
  index("idx_audit_logs_created_at").on(t.createdAt),
  // Added by 0010_audit_schema.sql
  index("idx_audit_logs_entity").on(t.entityType, t.entityId, t.createdAt),
  index("idx_audit_logs_user_created").on(t.userId, t.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
