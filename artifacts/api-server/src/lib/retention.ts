/**
 * retention.ts — B2.3b file retention policy (single source of truth)
 *
 * Product Policy v1 (ADR-0007 direction): a soft-deleted document file is
 * retained (restorable, storage kept) for FILE_RETENTION_DAYS before it becomes
 * eligible for the (gated) B2.3b-2 purge worker.
 *
 * This is the ONE place the number lives — routes and tests import it, never
 * hard-code 90. It is intentionally a constant now; a per-organization override
 * lands with the Retention Configuration workstream (a B2.3b-2 prerequisite).
 */

/** Days a soft-deleted file is retained before it is purge-eligible. */
export const FILE_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the purge-eligibility timestamp for a file soft-deleted at `deletedAt`.
 * Pure — no clock read — so callers pass the same `now` they stamp `deletedAt`
 * with, keeping the two columns exactly `FILE_RETENTION_DAYS` apart.
 */
export function computeFilePurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + FILE_RETENTION_DAYS * MS_PER_DAY);
}
