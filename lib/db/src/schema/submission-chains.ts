import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable, projectParticipantsTable } from "./projects";
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

// Phase 3: how the actual user is resolved when a step lands on a participant.
//   named        — always route to defaultAssigneeId
//   role_based   — any reviewer+ in the participant's linked org on this project
//   unassigned   — RESERVED; Phase-3 API rejects this value at validation time
export const assignmentStrategyEnum = pgEnum("assignment_strategy", [
  "named",
  "role_based",
  "unassigned",
]);

// ─── submission_chains ────────────────────────────────────────────────────────

export const submissionChainsTable = pgTable("submission_chains", {
  id: serial("id").primaryKey(),

  chainNumber: text("chain_number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),

  // Phase 3: document submission type. 'rfi', 'ncr', 'mir' reserved for future.
  type: text("type").notNull().default("submittal"),

  projectId: integer("project_id")
    .references(() => projectsTable.id, { onDelete: "cascade" })
    .notNull(),

  originatingOrgId: integer("originating_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  currentOrgId: integer("current_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  // Phase 3: participant-level custodian. Set by setup-parties; updated on
  // every forward/return/resubmit. Null for chains created before Phase 3.
  currentParticipantId: integer("current_participant_id")
    .references(() => projectParticipantsTable.id, { onDelete: "set null" }),

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
// Defines which participants may take part in a chain and in what order.
// step_order 1 = originator, 2 = first reviewer, 3 = next, etc.
//
// Phase 3 migration note: org_id is DEPRECATED — its NOT NULL constraint was
// dropped in migration 0025. New rows use participant_id instead. The column
// will be dropped after production has been verified clean.

export const submissionChainAllowedPartiesTable = pgTable("submission_chain_allowed_parties", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id")
    .references(() => submissionChainsTable.id, { onDelete: "cascade" })
    .notNull(),

  // DEPRECATED: use participantId. Still nullable to preserve existing rows.
  orgId: integer("org_id")
    .references(() => organizationsTable.id),

  // Phase 3: primary routing reference.
  participantId: integer("participant_id")
    .references(() => projectParticipantsTable.id, { onDelete: "cascade" }),

  stepOrder: integer("step_order").notNull(),
  label: text("label"),

  assignmentStrategy: assignmentStrategyEnum("assignment_strategy")
    .notNull()
    .default("role_based"),

  defaultAssigneeId: integer("default_assignee_id")
    .references(() => usersTable.id),
});

// ─── submission_chain_steps ───────────────────────────────────────────────────
// One row per movement event (forward or return).
// review_code + comments record what the receiving party thought of the package.

export const submissionChainStepsTable = pgTable("submission_chain_steps", {
  id: serial("id").primaryKey(),

  chainId: integer("chain_id")
    .references(() => submissionChainsTable.id, { onDelete: "cascade" })
    .notNull(),

  stepNumber: integer("step_number").notNull(),
  revisionCycle: integer("revision_cycle").notNull(),

  action: chainStepActionEnum("action").notNull(),

  fromOrgId: integer("from_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  toOrgId: integer("to_org_id")
    .references(() => organizationsTable.id)
    .notNull(),

  // Phase 3: participant-level movement tracking (nullable — pre-Phase-3 rows = null).
  fromParticipantId: integer("from_participant_id")
    .references(() => projectParticipantsTable.id, { onDelete: "set null" }),

  toParticipantId: integer("to_participant_id")
    .references(() => projectParticipantsTable.id, { onDelete: "set null" }),

  actionedById: integer("actioned_by_id")
    .references(() => usersTable.id),

  stepStatus: chainStepStatusEnum("step_status")
    .notNull()
    .default("pending"),

  // Review fields — set by POST /:id/review before or after forward/return.
  // reviewCode = null means no formal review was recorded for this step.
  reviewCode: text("review_code"),
  comments: text("comments"),
  reviewedById: integer("reviewed_by_id")
    .references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at"),

  transmittalId: integer("transmittal_id")
    .references(() => transmittalsTable.id),

  assignedToUserId: integer("assigned_to_user_id")
    .references(() => usersTable.id),

  reassignedAt: timestamp("reassigned_at"),
  reassignedById: integer("reassigned_by_id")
    .references(() => usersTable.id),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── submission_chain_documents ───────────────────────────────────────────────

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

  revisionCycle: integer("revision_cycle").notNull(),

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
export type SubmissionChainAllowedParty = typeof submissionChainAllowedPartiesTable.$inferSelect;
export type InsertSubmissionChain = z.infer<typeof insertSubmissionChainSchema>;
export type InsertSubmissionChainStep = z.infer<typeof insertSubmissionChainStepSchema>;
