import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { documentsTable, documentRevisionsTable } from "./documents";
import { transmittalsTable } from "./transmittals";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const submissionChainStatusEnum = pgEnum("submission_chain_status", [
  "draft",
  "active",
  "returned",
  "approved",
  "approved_with_comments",
  "closed",
]);

export const chainStepActionEnum = pgEnum("chain_step_action", [
  "forward",
  "return",
]);

export const chainStepStatusEnum = pgEnum("chain_step_status", [
  "pending",
  "under_review",
  "reviewed",
  "actioned",
]);

// ─── submission_chains ────────────────────────────────────────────────────────
// The top-level workflow entity. One chain per formal submission package.
// Tracks which organisation currently holds the package and how long it has
// been sitting with them (current_step_started_at → SLA / aging).

export const submissionChainsTable = pgTable("submission_chains", {
  id: serial("id").primaryKey(),

  chainNumber: text("chain_number").notNull().unique(),       // e.g. SC-PROJ-2024-001
  title: text("title").notNull(),
  description: text("description"),

  projectId: integer("project_id")
    .references(() => projectsTable.id, { onDelete: "cascade" })
    .notNull(),

  originatingOrgId: integer("originating_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  currentOrgId: integer("current_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  currentStatus: submissionChainStatusEnum("current_status")
    .notNull()
    .default("draft"),

  activeRevisionCycle: integer("active_revision_cycle")
    .notNull()
    .default(1),

  // SLA / aging: reset on every forward, return, or resubmit action
  currentStepStartedAt: timestamp("current_step_started_at").defaultNow().notNull(),

  // Set automatically when all active-cycle documents reach review code A
  autoClosedAt: timestamp("auto_closed_at"),

  createdById: integer("created_by_id")
    .references(() => usersTable.id)
    .notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── submission_chain_allowed_parties ─────────────────────────────────────────
// Defines which organisations may participate in a chain and in what order.
// step_order 1 = originator, 2 = next party, 3 = next-next, etc.
// Forward   → moves to step_order + 1
// Return    → moves to step_order − 1
// Arbitrary jumps are blocked at the API level.

export const submissionChainAllowedPartiesTable = pgTable("submission_chain_allowed_parties", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id")
    .references(() => submissionChainsTable.id, { onDelete: "cascade" })
    .notNull(),
  orgId: integer("org_id")
    .references(() => organizationsTable.id)
    .notNull(),
  stepOrder: integer("step_order").notNull(),        // 1-based; defines valid sequence
  label: text("label"),                              // optional role label: "Subcontractor", "MC", "Consultant", "Owner"
  // User-level assignment: who is normally responsible in this org for this chain
  defaultAssigneeId: integer("default_assignee_id")
    .references(() => usersTable.id),
});

// ─── submission_chain_steps ───────────────────────────────────────────────────
// One row per movement event (forward or return) or review action.
// A new step can only be created once the current latest step is 'actioned'.
// review_code is nullable — forwarding without review is explicitly allowed;
// the UI renders such steps with a "Forwarded without review" label.

export const submissionChainStepsTable = pgTable("submission_chain_steps", {
  id: serial("id").primaryKey(),

  chainId: integer("chain_id")
    .references(() => submissionChainsTable.id, { onDelete: "cascade" })
    .notNull(),

  stepNumber: integer("step_number").notNull(),       // global sequence within the chain (1, 2, 3…)
  revisionCycle: integer("revision_cycle").notNull(), // which revision cycle this step belongs to

  action: chainStepActionEnum("action").notNull(),    // forward | return

  fromOrgId: integer("from_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  toOrgId: integer("to_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  actionedById: integer("actioned_by_id")
    .references(() => usersTable.id),

  stepStatus: chainStepStatusEnum("step_status")
    .notNull()
    .default("pending"),

  // Review fields — populated when the receiving org records a review.
  // review_code = null means forwarded without formal review.
  reviewCode: text("review_code"),     // A | B | C | D | null
  comments: text("comments"),
  reviewedById: integer("reviewed_by_id")
    .references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),

  // Linked only when the user explicitly chooses "Review + Send Transmittal".
  // Never auto-populated.
  transmittalId: integer("transmittal_id")
    .references(() => transmittalsTable.id),

  // User-level assignment — who in toOrg is specifically responsible for this step.
  // Pre-filled from allowed_parties.default_assignee_id; overridable at forward time.
  assignedToUserId: integer("assigned_to_user_id")
    .references(() => usersTable.id),

  // Reassignment audit — populated if a DC+/PM within toOrg changes the assignee
  reassignedAt: timestamp("reassigned_at"),
  reassignedById: integer("reassigned_by_id")
    .references(() => usersTable.id),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── submission_chain_documents ───────────────────────────────────────────────
// Tracks which specific document revision is in scope for each revision cycle.
// Old-cycle rows are permanent and immutable (enforced at API level).
// When a new revision cycle opens, new rows are inserted for the corrected
// revisions; the originals remain untouched.

export const submissionChainDocumentsTable = pgTable("submission_chain_documents", {
  id: serial("id").primaryKey(),

  chainId: integer("chain_id")
    .references(() => submissionChainsTable.id, { onDelete: "cascade" })
    .notNull(),

  documentId: integer("document_id")
    .references(() => documentsTable.id)
    .notNull(),

  revisionId: integer("revision_id")
    .references(() => documentRevisionsTable.id)
    .notNull(),

  revisionCycle: integer("revision_cycle").notNull(), // which cycle introduced this doc/revision

  addedById: integer("added_by_id")
    .references(() => usersTable.id),

  addedAt: timestamp("added_at").defaultNow().notNull(),
});

// ─── Zod insert schemas ───────────────────────────────────────────────────────

export const insertSubmissionChainSchema = createInsertSchema(submissionChainsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  autoClosedAt: true,
  currentStepStartedAt: true,
});

export const insertSubmissionChainStepSchema = createInsertSchema(submissionChainStepsTable).omit({
  id: true,
  createdAt: true,
});

export const insertSubmissionChainDocumentSchema = createInsertSchema(submissionChainDocumentsTable).omit({
  id: true,
  addedAt: true,
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type SubmissionChain = typeof submissionChainsTable.$inferSelect;
export type SubmissionChainStep = typeof submissionChainStepsTable.$inferSelect;
export type SubmissionChainDocument = typeof submissionChainDocumentsTable.$inferSelect;
export type InsertSubmissionChain = z.infer<typeof insertSubmissionChainSchema>;
export type InsertSubmissionChainStep = z.infer<typeof insertSubmissionChainStepSchema>;
