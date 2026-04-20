/**
 * requireModule — fail-CLOSED module gate middleware.
 *
 * ─── ARCHITECTURAL NOTE (Phase 3) ────────────────────────────────────────────
 *
 * requireModule is registered in the PARENT router (routes/index.ts) but
 * requireAuth runs INSIDE each sub-router. This means req.user is undefined
 * when requireModule fires. To resolve the orgId, requireModule reads the JWT
 * directly from the Authorization header via verifyToken().
 *
 * This is the CORRECT Phase 3 approach:
 *   - self-contained JWT read (no dependency on requireAuth ordering)
 *   - safe: invalid/missing JWT → orgId undefined → next() (same as before)
 *   - compatible with both legacy and plan-driven paths
 *
 * ─── TWO PATHS (Phase 3 safe rollout) ────────────────────────────────────────
 *
 * LEGACY PATH (default — all orgs unless in canary set):
 *   Reads org_config.modules from DB.
 *   org_config.modules is kept fresh by ModuleSyncService (Phase 3).
 *   After Phase 2.95, modules correctly reflect plan defaults.
 *
 * PLAN-DRIVEN PATH (canary — opt-in per org or globally):
 *   Computes effective module access at request time from:
 *     plan defaults (getDefaultModulesForPlan)  +  active org_feature_overrides
 *   Tests the Phase 3 plan-catalog read path without touching production orgs.
 *
 * ─── CANARY CONFIGURATION ─────────────────────────────────────────────────────
 *
 *   MODULE_CANARY_ORG_IDS=1,5,12       — specific org IDs (comma-separated)
 *   MODULE_CANARY_ORG_IDS=all          — all orgs use plan-driven path
 *   MODULE_CANARY_ORG_IDS=             — (empty) legacy path (default)
 *
 * ─── SECURITY POLICY (both paths) ────────────────────────────────────────────
 *
 *  - system_owner (no orgId)  → always pass through (cross-tenant admin)
 *  - invalid / missing JWT    → next() (requireAuth in sub-router handles 401)
 *  - missing config / plan    → 403 config_missing  (fail-closed)
 *  - module flag is false     → 403 MODULE_DISABLED
 *  - DB error                 → 503 service_unavailable
 *
 * Logging:
 *  - INFO  on module allowed (canary path) with path_label: "plan-driven"
 *  - INFO  on module denied  with path_label: "legacy" or "plan-driven"
 *  - WARN  on missing config row
 *  - ERROR on DB errors
 */

import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  orgConfigTable,
  subscriptionsTable,
  organizationsTable,
  orgFeatureOverridesTable,
} from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getDefaultModulesForPlan } from "../lib/plans.js";
import { verifyToken } from "../lib/auth.js";

export type ModuleKey = "dashboard" | "deliverables" | "registers" | "notifications" | "chat";

// ─── Canary set — parsed once at module load ──────────────────────────────────

function parseCanarySet(): Set<number> | "all" {
  const raw = (process.env.MODULE_CANARY_ORG_IDS ?? "").trim();
  if (!raw) return new Set<number>();
  if (raw === "all") return "all";
  const ids = raw
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !Number.isNaN(n) && n > 0);
  return new Set(ids);
}

const CANARY_SET = parseCanarySet();

function isCanary(orgId: number): boolean {
  if (CANARY_SET === "all") return true;
  return CANARY_SET.has(Number(orgId));
}

if (CANARY_SET === "all") {
  logger.info("[require-module] CANARY=all — ALL orgs using plan-driven module check");
} else if (CANARY_SET.size > 0) {
  logger.info(
    { canaryOrgIds: [...CANARY_SET] },
    "[require-module] canary orgs configured — these orgs use plan-driven module check",
  );
} else {
  logger.info("[require-module] no canary — all orgs use legacy org_config.modules path");
}

// ─── JWT-based orgId resolution ───────────────────────────────────────────────
// requireModule runs in the parent router before requireAuth fires in sub-routers.
// We resolve orgId directly from the Authorization header JWT so we have it
// available regardless of where requireAuth is positioned.

function resolveOrgId(req: Request): number | undefined {
  // Prefer req.user if already set (e.g., after requireAuth runs in middleware chain)
  if (req.user?.organizationId) return Number(req.user.organizationId);

  // Fall back to JWT decode from Authorization header
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return undefined;
  const orgId = payload.organizationId;
  if (!orgId) return undefined;
  return Number(orgId);
}

// ─── Plan-driven check helper ─────────────────────────────────────────────────

async function computePlanDrivenAccess(
  orgId: number,
  moduleName: ModuleKey,
): Promise<boolean | null> {
  let planId = "free";
  try {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organizationId, orgId))
      .limit(1);

    if (sub?.planId) {
      planId = sub.planId;
    } else {
      const [org] = await db
        .select({ subscriptionTier: organizationsTable.subscriptionTier })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId))
        .limit(1);
      planId = org?.subscriptionTier ?? "free";
    }
  } catch (err) {
    logger.error({ err, orgId }, "[require-module:canary] DB error resolving plan");
    return null;
  }

  const planDefaults = getDefaultModulesForPlan(planId);
  let isEnabled: boolean = (planDefaults as Record<string, boolean>)[moduleName] ?? false;

  try {
    const now = new Date();
    const [override] = await db
      .select({ isEnabled: orgFeatureOverridesTable.isEnabled })
      .from(orgFeatureOverridesTable)
      .where(and(
        eq(orgFeatureOverridesTable.organizationId, orgId),
        eq(orgFeatureOverridesTable.featureKey, moduleName),
        or(
          isNull(orgFeatureOverridesTable.expiresAt),
          gt(orgFeatureOverridesTable.expiresAt, now),
        ),
      ))
      .limit(1);

    if (override !== undefined) {
      isEnabled = override.isEnabled;
    }
  } catch (err) {
    logger.error({ err, orgId, moduleName }, "[require-module:canary] DB error reading feature override — using plan default");
  }

  return isEnabled;
}

// ─── requireModule ────────────────────────────────────────────────────────────

export function requireModule(moduleName: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Resolve orgId from req.user (if already set) OR from JWT in Authorization header
    const orgId = resolveOrgId(req);

    // system_owner intentionally has no orgId — cross-tenant admin, bypass all gates.
    // Also pass through if JWT is missing/invalid — requireAuth in sub-router handles 401.
    if (!orgId) {
      next();
      return;
    }

    // ── Route to canary (plan-driven) or legacy path ──────────────────────
    if (isCanary(orgId)) {
      return planDrivenCheck(req, res, next, orgId, moduleName);
    }
    return legacyCheck(req, res, next, orgId, moduleName);
  };
}

// ─── Legacy path — reads org_config.modules ───────────────────────────────────

async function legacyCheck(
  req:        Request,
  res:        Response,
  next:       NextFunction,
  orgId:      number,
  moduleName: ModuleKey,
): Promise<void> {
  try {
    const [config] = await db
      .select({ modules: orgConfigTable.modules })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, orgId));

    if (!config) {
      logger.warn(
        { orgId, module: moduleName, method: req.method, path: req.path, path_label: "legacy" },
        "[security] config_missing: no org_config row found — access denied (fail-closed)",
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
        { orgId, module: moduleName, method: req.method, path: req.path, path_label: "legacy" },
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
      { err, orgId, module: moduleName, method: req.method, path: req.path, path_label: "legacy" },
      "[security] require-module: DB error during config lookup — returning 503",
    );
    res.status(503).json({
      error: "service_unavailable",
      message: "Unable to verify feature access. Please try again in a moment.",
    });
  }
}

// ─── Canary path — computes access from plan catalog + overrides ──────────────

async function planDrivenCheck(
  req:        Request,
  res:        Response,
  next:       NextFunction,
  orgId:      number,
  moduleName: ModuleKey,
): Promise<void> {
  try {
    const isEnabled = await computePlanDrivenAccess(orgId, moduleName);

    if (isEnabled === null) {
      res.status(503).json({
        error: "service_unavailable",
        message: "Unable to verify feature access. Please try again in a moment.",
      });
      return;
    }

    if (!isEnabled) {
      logger.info(
        { orgId, module: moduleName, method: req.method, path: req.path, path_label: "plan-driven" },
        "[access] module_disabled: feature access denied by plan (canary path)",
      );
      res.status(403).json({
        error: "MODULE_DISABLED",
        message: `The "${moduleName}" module is not enabled for your organisation. Please upgrade your plan or contact your administrator.`,
        module: moduleName,
      });
      return;
    }

    logger.info(
      { orgId, module: moduleName, method: req.method, path: req.path, path_label: "plan-driven" },
      "[access] module_allowed (canary plan-driven path)",
    );
    next();
  } catch (err) {
    logger.error(
      { err, orgId, module: moduleName, method: req.method, path: req.path, path_label: "plan-driven" },
      "[security] require-module canary: unexpected error — returning 503",
    );
    res.status(503).json({
      error: "service_unavailable",
      message: "Unable to verify feature access. Please try again in a moment.",
    });
  }
}
