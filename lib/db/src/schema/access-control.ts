import {
  pgTable, serial, text, integer, boolean, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { documentsTable } from "./documents";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";

// ─── document_access_rules ────────────────────────────────────────────────────
//
// Explicit per-document, per-department allow or deny overrides.
//
// Architecture rules:
//   - 'deny'  beats any 'allow', any dept_match, and any workflow grant.
//   - 'allow' grants access independent of dept_match.
//   - system_owner is the only role immune to a deny rule.
//   - Rows are org-scoped transitively through departments.organization_id.
//
export const documentAccessRulesTable = pgTable("document_access_rules", {
  id:           serial("id").primaryKey(),
  documentId:   integer("document_id").notNull()
                  .references(() => documentsTable.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").notNull()
                  .references(() => departmentsTable.id, { onDelete: "cascade" }),
  ruleType:     text("rule_type").notNull(),        // 'allow' | 'deny'
  grantedById:  integer("granted_by_id")
                  .references(() => usersTable.id, { onDelete: "set null" }),
  reason:       text("reason"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("doc_access_rule_uniq").on(t.documentId, t.departmentId, t.ruleType),
  index("idx_doc_access_rules_doc").on(t.documentId),
  index("idx_doc_access_rules_dept").on(t.departmentId),
]);

// ─── document_confidential_access ─────────────────────────────────────────────
//
// Allowlist for documents marked as confidential (documents.is_confidential=true).
//
// Architecture rules:
//   - Only users explicitly on this list (by user_id OR by a dept they belong to)
//     may see the document after it is marked confidential.
//   - project_manager role does NOT bypass this gate.
//   - admin / org_owner roles do NOT bypass this gate.
//   - system_owner bypasses everything.
//   - Optional expires_at: null means permanent grant.
//
// App-layer constraint: at least one of user_id / department_id must be non-null.
//
export const documentConfidentialAccessTable = pgTable("document_confidential_access", {
  id:           serial("id").primaryKey(),
  documentId:   integer("document_id").notNull()
                  .references(() => documentsTable.id, { onDelete: "cascade" }),
  userId:       integer("user_id")
                  .references(() => usersTable.id, { onDelete: "cascade" }),
  departmentId: integer("department_id")
                  .references(() => departmentsTable.id, { onDelete: "cascade" }),
  grantedById:  integer("granted_by_id")
                  .references(() => usersTable.id, { onDelete: "set null" }),
  grantedAt:    timestamp("granted_at").defaultNow().notNull(),
  expiresAt:    timestamp("expires_at"),
  reason:       text("reason"),
}, (t) => [
  index("idx_doc_conf_doc").on(t.documentId),
  index("idx_doc_conf_user").on(t.userId),
  index("idx_doc_conf_dept").on(t.departmentId),
]);

// ─── access_shadow_log ────────────────────────────────────────────────────────
//
// Persistent audit log of shadow resolver evaluations.
//
// No FK on document_id / project_id — records survive document deletion.
// Divergences (diverges=true) are always persisted; agreements are sampled.
//
export const accessShadowLogTable = pgTable("access_shadow_log", {
  id:               serial("id").primaryKey(),
  documentId:       integer("document_id"),
  userId:           integer("user_id").notNull(),
  userRole:         text("user_role").notNull(),
  projectId:        integer("project_id"),
  systemAllowed:    boolean("system_allowed").notNull(),
  resolverAllowed:  boolean("resolver_allowed").notNull(),
  resolverReasons:  text("resolver_reasons").array().notNull().default([]),
  rulePath:         text("rule_path").notNull(),
  diverges:         boolean("diverges").notNull(),
  // Context snapshot — used for analytics without re-parsing JSON logs
  userDeptIds:      integer("user_dept_ids").array().notNull().default([]),
  docDeptIds:       integer("doc_dept_ids").array().notNull().default([]),
  hasConfidential:  boolean("has_confidential").notNull().default(false),
  hasDenyRule:      boolean("has_deny_rule").notNull().default(false),
  hasWorkflowGrant: boolean("has_workflow_grant").notNull().default(false),
  evaluatedAt:      timestamp("evaluated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_shadow_doc").on(t.documentId),
  index("idx_shadow_user").on(t.userId),
  index("idx_shadow_diverges").on(t.diverges),
  index("idx_shadow_evaluated_at").on(t.evaluatedAt),
]);

export type DocumentAccessRule         = typeof documentAccessRulesTable.$inferSelect;
export type DocumentConfidentialAccess = typeof documentConfidentialAccessTable.$inferSelect;
export type AccessShadowLog            = typeof accessShadowLogTable.$inferSelect;
