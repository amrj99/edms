/**
 * classification-events.ts — DEBT-010 (owner decision, 2026-08-24).
 *
 * Explicit BACKGROUND boundary for AI classification fired from an HTTP request.
 * Classification does AI/network I/O and must run AFTER the request's business
 * commit, must NOT inherit the request's AsyncLocalStorage (neither the
 * fail-closed marker nor the request's tenant tx), and must never hold a DB
 * transaction across the AI call.
 *
 * Contract (owner-mandated):
 *   • Caller does: withTenant(business) → commit → dispatchClassificationBackground(...).
 *   • Carries EXPLICIT context ({organizationId, userId, itemType, itemId} + the
 *     minimal fields classifyItem needs); never reads identity from the request ALS.
 *   • AI / network I/O stays OUTSIDE any DB transaction.
 *   • Detached from the request ALS → classifyItem's infra-DB reads (settings /
 *     quota / ai logs — non-RLS) run on the AI subsystem's own (background) path,
 *     NOT the request tenant tx. This is NOT a general poolDb and NOT runUnscoped.
 *   • ⚠️ edms_app gate: if AI classification ever needs a TENANT (RLS) table, that
 *     access must go through its own runInTenantTx with the explicit org context —
 *     tracked in qa/OPEN_DEBT.md (background-jobs tenant context).
 */
import { requestContext, dbContext } from "@workspace/db";
import { classifyItem } from "../ai-documents.js";
import { logger } from "../logger.js";

/**
 * Run `fn` fully DETACHED from the HTTP request's ALS (request marker + tenant tx
 * are both cleared inside). Dedicated to the AI classification boundary — not a
 * general escape, not exported.
 */
function runDetachedFromRequest<T>(fn: () => T): T {
  return requestContext.exit(() => dbContext.exit(fn));
}

export function dispatchClassificationBackground(
  ctx: { organizationId: number; userId: number; itemType: "document" | "correspondence"; itemId: number },
  input: { title?: string | null; documentType?: string | null; discipline?: string | null; subject?: string | null; body?: string | null },
): void {
  runDetachedFromRequest(() => {
    void classifyItem({
      type: ctx.itemType,
      organizationId: ctx.organizationId,
      ...input,
    }).catch((err) => logger.warn({ err, itemType: ctx.itemType, itemId: ctx.itemId }, "ai-classification: background dispatch failed"));
  });
}

/**
 * AWAITED detached classification — for callers that need the result synchronously
 * (e.g. documents POST persists aiTags/aiPriority and returns them in the response).
 * Runs classifyItem DETACHED from the request ALS so its AI/network I/O and infra-DB
 * reads never touch the request's tenant transaction. The caller MUST invoke this
 * AFTER its business commit and OUTSIDE any withTenant(), then persist the result via
 * its OWN short withTenant() update. Returns null on any failure (best-effort).
 */
export function classifyDetached(
  ctx: { organizationId: number | null; itemType: "document" | "correspondence" },
  input: { title?: string | null; documentType?: string | null; discipline?: string | null; subject?: string | null; body?: string | null },
): Promise<Awaited<ReturnType<typeof classifyItem>>> {
  return requestContext.exit(() => dbContext.exit(() =>
    classifyItem({ type: ctx.itemType, organizationId: ctx.organizationId, ...input })
      .catch((err) => { logger.warn({ err, itemType: ctx.itemType }, "ai-classification: detached classify failed"); return null; }),
  ));
}

// Test-only seam — assert detachment without running real AI logic.
export const __test = { runDetachedFromRequest };
