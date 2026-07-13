import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

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
 * Fire-and-forget: errors are caught and logged so that an audit write
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
 *
 * WHY RAW SQL:
 *   Drizzle 0.45 includes every column defined in the table schema in each
 *   INSERT, emitting DEFAULT for keys absent from the values object.  When
 *   the optional 0010 migration columns do not yet exist in the target database
 *   that produces "column does not exist" from Postgres, which is silently
 *   swallowed by the catch block and results in no row being written.
 *   Building the INSERT with sql.join() lets us include only the columns that
 *   have actual values, making the function resilient across migration states.
 */
export interface AuditLogParams {
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
}

/** A db handle or an open transaction — anything that can .execute() SQL. */
type AuditExecutor = Pick<typeof db, "execute">;

/**
 * Build the audit INSERT with only the columns that carry a real value, so the
 * statement succeeds across migration states (see WHY RAW SQL above). Pure —
 * shared by the fire-and-forget and transactional variants.
 */
function buildAuditInsert(params: AuditLogParams) {
  type SQLChunk = ReturnType<typeof sql>;
  const cols: SQLChunk[] = [];
  const vals: SQLChunk[] = [];

  const add = (col: string, val: unknown) => {
    cols.push(sql.raw(`"${col}"`));
    vals.push(sql`${val}`);
  };

  // Base columns — always present in every audit row.
  if (params.userId !== undefined)         add("user_id",         params.userId);
  if (params.organizationId !== undefined) add("organization_id", params.organizationId);
  add("action",      params.action);
  add("entity_type", params.entityType);
  add("entity_id",   params.entityId);
  if (params.entityTitle !== undefined)    add("entity_title", params.entityTitle);
  add("details", params.details ?? {});
  if (params.projectId !== undefined)      add("project_id",  params.projectId);
  if (params.ipAddress !== undefined)      add("ip_address",  params.ipAddress);

  // 0010_audit_schema.sql columns — only included when the caller provides
  // a value so the INSERT succeeds even if the migration has not yet been
  // applied to the target database.
  if (params.beforeState !== undefined) add("before_state", params.beforeState);
  if (params.afterState  !== undefined) add("after_state",  params.afterState);
  if (params.actorRole   !== undefined) add("actor_role",   params.actorRole);
  if (params.userAgent   !== undefined) add("user_agent",   params.userAgent);

  return sql`INSERT INTO audit_logs (${sql.join(cols, sql`, `)}) VALUES (${sql.join(vals, sql`, `)})`;
}

export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await db.execute(buildAuditInsert(params));
  } catch (err) {
    // Audit logs must never break the main request flow.
    // Log so that silent INSERT failures are visible in server output.
    console.error("[audit] createAuditLog failed:", (err as Error)?.message ?? err);
  }
}

/**
 * B2.3a — Transactional audit write.
 *
 * Unlike createAuditLog, this deliberately does NOT swallow errors: it runs
 * inside the caller's db.transaction(), so a failed audit INSERT MUST propagate
 * and roll the whole transaction back. This is what guarantees "no success
 * audit row for a failed operation" — the audit is committed atomically with
 * the state change it describes, or not at all.
 */
export async function createAuditLogTx(tx: AuditExecutor, params: AuditLogParams): Promise<void> {
  await tx.execute(buildAuditInsert(params));
}
