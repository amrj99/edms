/**
 * requireAiEnabled — fail-CLOSED AI governance gate.
 *
 * ─── PURPOSE ──────────────────────────────────────────────────────────────────
 *
 * Enforces the organization-level AI master switch (org_config.ai_enabled).
 * Applied at the /api/ai router level in routes/index.ts so every AI inference
 * endpoint is protected by a single authoritative check.
 *
 * ─── BYPASS RULES ─────────────────────────────────────────────────────────────
 *
 *   system_owner (no orgId)  → always pass through (cross-tenant operator)
 *   missing / invalid JWT    → pass through (requireAuth in sub-router handles 401)
 *   path starts with /settings → pass through (admins must access settings to enable AI)
 *
 * ─── RESPONSES ────────────────────────────────────────────────────────────────
 *
 *   ai_enabled = false  → 403  AI_DISABLED       { upgradeRequired: true }
 *   missing config row  → 403  config_missing
 *   DB error            → 503  service_unavailable
 *
 * ─── SECURITY NOTE ────────────────────────────────────────────────────────────
 *
 * Backend enforcement is authoritative. Frontend AI gating (hiding menu items,
 * disabling buttons) is UX only and is never relied upon for access control.
 */

import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { verifyToken } from "../lib/auth.js";

function resolveOrgId(req: Request): number | undefined {
  if (req.user?.organizationId) return Number(req.user.organizationId);

  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return undefined;
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) return undefined;
  const orgId = payload.organizationId;
  if (!orgId) return undefined;
  return Number(orgId);
}

export function requireAiEnabled() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── Settings bypass: admins need /settings to enable/configure AI ─────────
    if (req.path === "/settings" || req.path.startsWith("/settings")) {
      next();
      return;
    }

    const orgId = resolveOrgId(req);

    // ── No orgId = system_owner or unauthenticated ─────────────────────────────
    // system_owner spans all tenants and has no orgId by design.
    // Unauthenticated requests pass through; requireAuth in the sub-router handles 401.
    if (!orgId) {
      next();
      return;
    }

    try {
      const [config] = await db
        .select({
          aiEnabled: orgConfigTable.aiEnabled,
          aiPlan: orgConfigTable.aiPlan,
        })
        .from(orgConfigTable)
        .where(eq(orgConfigTable.organizationId, orgId));

      if (!config) {
        logger.warn(
          { orgId, method: req.method, path: req.path },
          "[security] require-ai-enabled: no org_config row — access denied (fail-closed)",
        );
        res.status(403).json({
          error: "config_missing",
          message: "Your organization has no AI configuration. Please contact your system administrator.",
        });
        return;
      }

      if (!config.aiEnabled) {
        logger.info(
          { orgId, aiPlan: config.aiPlan, method: req.method, path: req.path },
          "[access] AI_DISABLED: AI access denied by org governance policy",
        );
        res.status(403).json({
          error: "AI_DISABLED",
          message: "AI is not enabled for your organization. Contact your administrator to enable AI access.",
          aiPlan: config.aiPlan ?? "disabled",
          upgradeRequired: true,
        });
        return;
      }

      next();
    } catch (err) {
      logger.error(
        { err, orgId, method: req.method, path: req.path },
        "[security] require-ai-enabled: DB error during AI governance check — returning 503",
      );
      res.status(503).json({
        error: "service_unavailable",
        message: "Unable to verify AI access. Please try again in a moment.",
      });
    }
  };
}
