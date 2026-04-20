/**
 * requireModule — fail-CLOSED module gate middleware.
 *
 * Security policy (Phase 0):
 *  - system_owner (no orgId) → always pass through (cross-tenant admin by design)
 *  - org has no config row  → 403 config_missing  (fail-closed, not fail-open)
 *  - module flag is false   → 403 MODULE_DISABLED
 *  - DB error               → 503 service_unavailable (not a silent pass-through)
 *
 * Logging:
 *  - WARN on missing config row  (operator action required)
 *  - INFO on module denied       (normal audit trail)
 *  - ERROR on DB errors
 */
import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type ModuleKey = "dashboard" | "deliverables" | "registers" | "notifications" | "chat";

export function requireModule(moduleName: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.user?.organizationId;

    // system_owner intentionally has no orgId — cross-tenant admin, bypass all module gates.
    if (!orgId) {
      next();
      return;
    }

    try {
      const [config] = await db
        .select({ modules: orgConfigTable.modules })
        .from(orgConfigTable)
        .where(eq(orgConfigTable.organizationId, orgId));

      // ── Fail-CLOSED: missing config row is an error condition, not a pass-through ──
      if (!config) {
        logger.warn(
          { orgId, module: moduleName, method: req.method, path: req.path },
          "[security] config_missing: no org_config row found — access denied (fail-closed)",
        );
        res.status(403).json({
          error: "config_missing",
          message: "Your organization has no feature configuration. Please contact your system administrator.",
        });
        return;
      }

      // Key-level logic: a module is disabled ONLY if the key is explicitly set to false.
      // Missing key (undefined) is treated as enabled — this preserves backward compatibility
      // for orgs whose config rows predate a new module being added to the system.
      // The security fix is at the ROW level above: missing config row = 403.
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
