import { Request, Response, NextFunction } from "express";
import { deductCredits, AI_FEATURE_COSTS, type AiFeature } from "../lib/ai-credits.js";

/**
 * Middleware factory that atomically deducts AI credits for a given feature.
 * Blocks the request with 402 if the organisation has insufficient balance.
 *
 * Usage:
 *   router.post("/summarise", requireAuth, requireAiCredits("ai_summary"), handler)
 */
export function requireAiCredits(feature: AiFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
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
