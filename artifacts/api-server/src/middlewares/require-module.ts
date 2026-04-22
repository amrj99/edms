/**
 * requireModule — fail-CLOSED module gate middleware.
 *
 * ─── SINGLE PATH (unified after Phase 3 cleanup) ──────────────────────────────
 *
 * Module access is resolved from org_config.modules (JSONB column).
 * This table is kept fresh by ModuleSyncService, which reconciles plan changes,
 * Stripe events, and manual overrides into org_config.modules automatically.
 *
 * This is the single authoritative path. The dual canary/legacy architecture
 * was removed once ModuleSyncService proved stable. All orgs use this path.
 *
 * ─── ARCHITECTURAL NOTE ───────────────────────────────────────────────────────
 *
 * requireModule is registered in the PARENT router (routes/index.ts) but
 * requireAuth runs INSIDE each sub-router. This means req.user may be undefined
 * when requireModule fires. To resolve the orgId, requireModule reads the JWT
 * directly from the Authorization header via verifyToken().
 *
 * ─── SECURITY POLICY ──────────────────────────────────────────────────────────
 *
 *  - system_owner (no orgId)  → always pass through (cross-tenant admin)
 *  - invalid / missing JWT    → next() (requireAuth in sub-router handles 401)
 *  - missing config row       → 403 config_missing  (fail-closed)
 *  - module flag is false     → 403 MODULE_DISABLED
 *  - DB error                 → 503 service_unavailable
 */

import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { verifyToken } from "../lib/auth.js";

export type ModuleKey = "dashboard" | "deliverables" | "registers" | "notifications" | "chat";

// ─── JWT-based orgId resolution ───────────────────────────────────────────────

function resolveOrgId(req: Request): number | undefined {
  if (req.user?.organizationId) return Number(req.user.organizationId);

  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return undefined;
  const orgId = payload.organizationId;
  if (!orgId) return undefined;
  return Number(orgId);
}

// ─── requireModule ────────────────────────────────────────────────────────────

export function requireModule(moduleName: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = resolveOrgId(req);

    // system_owner has no orgId — bypass all module gates.
    // Missing/invalid JWT — pass through, requireAuth in sub-router handles 401.
    if (!orgId) {
      next();
      return;
    }

    try {
      const [config] = await db
        .select({ modules: orgConfigTable.modules })
        .from(orgConfigTable)
        .where(eq(orgConfigTable.organizationId, orgId));

      if (!config) {
        logger.warn(
          { orgId, module: moduleName, method: req.method, path: req.path },
          "[security] config_missing: no org_config row — access denied (fail-closed)",
        );
        res.status(403).json({
          error: "config_missing",
          message: "Your organization has no feature configuration. Please contact your system administrator.",
        });
        return;
      }

      const modules = config.modules as Record<string, unknown> | null;
      const isEnabled = modules != null && modules[moduleName] !== false;

      if (!isEnabled) {
        logger.info(
          { orgId, module: moduleName, method: req.method, path: req.path },
          "[access] module_disabled: feature access denied by org config",
        );
        res.status(403).json({
          error: "MODULE_DISABLED",
          message: `The "${moduleName}" module is not enabled for your organisation. Please upgrade your plan or contact your administrator.`,
          module: moduleName,
        });
        return;
      }

      next();
    } catch (err) {
      logger.error(
        { err, orgId, module: moduleName, method: req.method, path: req.path },
        "[security] require-module: DB error during config lookup — returning 503",
      );
      res.status(503).json({
        error: "service_unavailable",
        message: "Unable to verify feature access. Please try again in a moment.",
      });
    }
  };
}
