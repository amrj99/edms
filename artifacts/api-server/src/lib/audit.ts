import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";

/**
 * Structured payload for audit log details.
 *
 * - `before` / `after`: structured state for UPDATE/DELETE events.
 *   Callers should populate these for any mutation that changes persistent state.
 * - Additional keys: domain-specific metadata (route, reason, tokenId, etc.)
 *
 * All fields are optional so existing call sites are unaffected.
 */
export interface AuditDetails {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Write a structured audit event to audit_logs.
 *
 * Fire-and-forget: errors are caught and suppressed so that an audit write
 * failure never interrupts the main request flow.
 *
 * The audit_logs table is append-only at the DB level (0009_audit_immutable.sql).
 * This function only ever INSERTs — never UPDATEs or DELETEs.
 *
 * New optional fields (added by 0010_audit_schema.sql):
 *   beforeState  — snapshot of entity fields before a mutation
 *   afterState   — snapshot of entity fields after a mutation
 *   actorRole    — resolved role of the acting user at the time of the event
 *   userAgent    — HTTP User-Agent header (for session forensics)
 */
export async function createAuditLog(params: {
  userId?: number;
  organizationId?: number;
  action: string;
  entityType: string;
  entityId: number;
  entityTitle?: string;
  details?: AuditDetails;
  projectId?: number;
  ipAddress?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  actorRole?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: params.userId,
      organizationId: params.organizationId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      entityTitle: params.entityTitle,
      details: params.details ?? {},
      projectId: params.projectId,
      ipAddress: params.ipAddress,
      beforeState: params.beforeState,
      afterState: params.afterState,
      actorRole: params.actorRole,
      userAgent: params.userAgent,
    });
  } catch {
    // Audit logs must never break the main request flow.
  }
}
