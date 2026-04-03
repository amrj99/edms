import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

// ─── Shared Approval Status Enum ──────────────────────────────────────────────
export const approvalStatusEnum = pgEnum("approval_status", ["none", "pending", "approved", "rejected"]);

// ─── Inspection Requests (ITR / MIR) ──────────────────────────────────────────
export const inspectionTypeEnum = pgEnum("inspection_type", ["itr", "mir"]);
export const inspectionStatusEnum = pgEnum("inspection_status", [
  "pending", "scheduled", "in_progress", "passed", "failed", "cancelled",
]);

export const inspectionRequestsTable = pgTable("inspection_requests", {
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull(),
  type: inspectionTypeEnum("type").notNull().default("itr"),
  description: text("description"),
  location: text("location"),
  date: timestamp("date"),
  status: inspectionStatusEnum("status").notNull().default("pending"),
  contractor: text("contractor"),
  linkedCorrespondenceId: integer("linked_correspondence_id"),
  linkedDocumentId: integer("linked_document_id"),
  remarks: text("remarks"),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  approvalStatus: approvalStatusEnum("approval_status").notNull().default("none"),
  approvedById: integer("approved_by_id").references(() => usersTable.id),
  approvalComment: text("approval_comment"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── NCR / SOR Records ────────────────────────────────────────────────────────
export const ncrTypeEnum = pgEnum("ncr_type", ["ncr", "sor"]);
export const ncrStatusEnum = pgEnum("ncr_status", ["open", "in_progress", "closed", "voided"]);

export const ncrRecordsTable = pgTable("ncr_records", {
  id: serial("id").primaryKey(),
  reportNumber: text("report_number").notNull(),
  type: ncrTypeEnum("type").notNull().default("ncr"),
  description: text("description"),
  location: text("location"),
  raisedBy: text("raised_by"),
  status: ncrStatusEnum("status").notNull().default("open"),
  correctiveAction: text("corrective_action"),
  closeDate: timestamp("close_date"),
  linkedDocumentId: integer("linked_document_id"),
  linkedCorrespondenceId: integer("linked_correspondence_id"),
  remarks: text("remarks"),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  approvalStatus: approvalStatusEnum("approval_status").notNull().default("none"),
  approvedById: integer("approved_by_id").references(() => usersTable.id),
  approvalComment: text("approval_comment"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── NOC Records ──────────────────────────────────────────────────────────────
export const nocStatusEnum = pgEnum("noc_status", ["pending", "approved", "rejected", "expired"]);

export const nocRecordsTable = pgTable("noc_records", {
  id: serial("id").primaryKey(),
  nocNumber: text("noc_number").notNull(),
  authority: text("authority"),
  date: timestamp("date"),
  status: nocStatusEnum("status").notNull().default("pending"),
  linkedDocumentId: integer("linked_document_id"),
  linkedCorrespondenceId: integer("linked_correspondence_id"),
  remarks: text("remarks"),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Register Column Configuration ────────────────────────────────────────────
export const registerColumnConfigTable = pgTable("register_column_config", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizationsTable.id)
    .notNull(),
  projectId: integer("project_id")
    .references(() => projectsTable.id),
  registerType: text("register_type").notNull(),
  columnKey: text("column_key").notNull(),
  isVisible: boolean("is_visible").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  columnLabel: text("column_label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RegisterColumnConfig = typeof registerColumnConfigTable.$inferSelect;
