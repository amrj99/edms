/**
 * skill-events.ts — DEBT-010 (owner decision B, 2026-08-24).
 *
 * Explicit BACKGROUND boundary for firing skill-engine events from an HTTP
 * request. A skill event must run AFTER the request's business commit and must
 * NOT inherit the request's AsyncLocalStorage (neither the fail-closed request
 * marker nor any open tenant transaction) — otherwise the detached skill work
 * would either fail-closed or reference a closed tx.
 *
 * Contract (owner-mandated):
 *   • Caller does: withTenant(business) → commit → dispatchSkillEventBackground(...).
 *   • The dispatcher carries EXPLICIT context (organizationId + userId + payload);
 *     it never reads identity from the request ALS.
 *   • This is NOT `runUnscoped` and NOT a general pool escape. It is a named
 *     background boundary specific to skill events.
 *   • ⚠️ edms_app gate: tenant DB access inside skill-engine/executeSkill must move
 *     to its own tenant scope (runInTenantTx with the explicit org context), not
 *     an unrestricted pool. Tracked in qa/OPEN_DEBT.md (background-jobs tenant ctx).
 *   • AI / external I/O inside skill execution stays OUTSIDE any DB transaction.
 */
import { requestContext, dbContext } from "@workspace/db";
import { triggerSkillEvent } from "./skill-engine.js";
import { logger } from "./logger.js";

export type SkillEventType = "task_completed" | "document_uploaded" | "project_status_changed";

/**
 * Run `fn` fully DETACHED from the HTTP request's ALS: inside here
 * requestContext.getStore() and dbContext.getStore() are both undefined, so any
 * work started here does not inherit the request marker or its tenant tx.
 * Dedicated to background skill dispatch — not exported as a general escape.
 */
function runDetachedFromRequest<T>(fn: () => T): T {
  return requestContext.exit(() => dbContext.exit(fn));
}

/**
 * Fire a skill event as detached background work with an explicit tenant context.
 * Fire-and-forget: never blocks or fails the caller's response.
 */
export function dispatchSkillEventBackground(
  ctx: { organizationId: number; userId: number },
  eventType: SkillEventType,
  payload: Record<string, unknown>,
): void {
  runDetachedFromRequest(() => {
    void triggerSkillEvent(eventType, {
      ...payload,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    }).catch((err) => logger.warn({ err, eventType }, "skill-engine: background dispatch failed"));
  });
}

// Test-only seam — lets the detachment be asserted without running real skill logic.
export const __test = { runDetachedFromRequest };
