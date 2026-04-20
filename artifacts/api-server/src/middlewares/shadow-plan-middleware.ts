/**
 * shadowPlanMiddleware — fire-and-forget shadow integration for Phase 2.5.
 *
 * Calls getResolvedPlan() on every authenticated request with an orgId,
 * but does so completely non-blocking (setImmediate) so it has zero latency
 * impact on the actual request.
 *
 * WHAT IT DOES:
 *   - Resolves the org's plan from the plans catalog
 *   - Emits plan.config.features and plan.config.quotas to the log
 *   - Detects and logs mismatches between:
 *       org_config.modules  vs plan defaults (getDefaultModulesForPlan)
 *       TIER_RPM            vs plans.rate_limit_rpm
 *       PLAN_LIMITS         vs plans.migration_max_files
 *
 * WHAT IT DOES NOT DO:
 *   - Does NOT block the request
 *   - Does NOT enforce anything
 *   - Does NOT modify org_config, modules, or any DB row
 *   - Does NOT change requireModule or rate-limit behavior
 *
 * CACHING:
 *   Org plans are cached for 5 minutes to prevent a shadow DB query on
 *   every single request.  Cache is in-process (no Redis needed).
 *
 * USAGE:
 *   Registered in app.ts after requireAuth so req.user is guaranteed.
 *   Shadow failures never surface to the client.
 */

import { Request, Response, NextFunction } from "express";
import { getResolvedPlan } from "../lib/plan-service.js";
import { logger } from "../lib/logger.js";

// ─── Per-org resolution cache (5-minute TTL) ──────────────────────────────────
// Prevents a DB query per request for shadow data that changes very infrequently.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const shadowCache = new Map<number, { resolvedAt: number }>();

function isCacheHot(orgId: number): boolean {
  const entry = shadowCache.get(orgId);
  if (!entry) return false;
  return Date.now() - entry.resolvedAt < CACHE_TTL_MS;
}

function markResolved(orgId: number): void {
  shadowCache.set(orgId, { resolvedAt: Date.now() });
  // Prune entries older than TTL to prevent unbounded memory growth
  if (shadowCache.size > 5000) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [id, entry] of shadowCache) {
      if (entry.resolvedAt < cutoff) shadowCache.delete(id);
    }
  }
}

/** Invalidate the shadow cache for an org (call after plan changes). */
export function invalidateShadowCache(orgId: number): void {
  shadowCache.delete(orgId);
}

// ─── Middleware ────────────────────────────────────────────────────────────────

/**
 * Non-blocking shadow middleware.
 *
 * Always calls next() immediately.  The shadow resolution runs in a
 * setImmediate callback after the response pipeline has started, so it
 * never adds latency to the request.
 */
export function shadowPlanMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Always unblock the request first — shadow work runs after
  next();

  const orgId = req.user?.organizationId;

  // system_owner has no orgId — skip
  if (!orgId) return;

  // Skip if we resolved this org recently
  if (isCacheHot(orgId)) return;

  // Fire-and-forget after current event-loop tick
  setImmediate(async () => {
    try {
      markResolved(orgId);
      await getResolvedPlan(orgId);
      // getResolvedPlan() handles all its own logging internally:
      //   INFO  — plan.config.features + plan.config.quotas
      //   WARN  — plan_not_in_catalog
      //   WARN  — module mismatches
      //   WARN  — quota mismatches
      //   INFO  — full resolution summary
    } catch (err) {
      // Shadow failures are non-fatal — log and continue
      logger.warn(
        { err, orgId },
        "[shadow-plan] unhandled error in shadow resolution — ignoring",
      );
    }
  });
}
