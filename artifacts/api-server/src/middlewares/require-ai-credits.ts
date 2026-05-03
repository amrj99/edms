import { Request, Response, NextFunction } from "express";
import { deductCredits, AI_FEATURE_COSTS, type AiFeature } from "../lib/ai-credits.js";
import { logger } from "../lib/logger.js";

/**
 * Middleware factory that atomically deducts AI credits for a given feature.
 * Blocks the request with 402 if the organisation has insufficient balance.
 *
 * system_owner exception:
 *   system_owner users bypass credit deduction entirely — they are platform
 *   operators, not paying tenants. Usage is logged (with orgOverride if present)
 *   for operational cost analysis only. No organisation balance is touched.
 *   This also prevents a null-reference crash since system_owner has no orgId.
 *
 * Usage:
 *   router.post("/summarise", requireAuth, requireAiCredits("ai_summary"), handler)
 */
export function requireAiCredits(feature: AiFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // ── system_owner bypass ────────────────────────────────────────────────
    if (req.user?.role === "system_owner") {
      logger.info(
        {
          userId: req.user.id,
          feature,
          cost: AI_FEATURE_COSTS[feature],
          orgOverride: req.query?.orgOverride ?? null,
          path: req.path,
          method: req.method,
        },
        "[ai-credits] system_owner usage — deduction bypassed (no org balance affected)",
      );
      next();
      return;
    }

    // ── Normal org-scoped enforcement ──────────────────────────────────────
    const orgId = req.user?.organizationId;
    if (!orgId) {
      res.status(400).json({ message: "No organisation context" });
      return;
    }

    const cost = AI_FEATURE_COSTS[feature];
    const deducted = await deductCredits(orgId, feature, {
      userId: req.user?.id,
      path: req.path,
    });

    if (!deducted) {
      res.status(402).json({
        message: "Insufficient AI credits",
        error: "AI_CREDITS_EXHAUSTED",
        feature,
        costRequired: cost,
      });
      return;
    }

    next();
  };
}
