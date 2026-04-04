import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type ModuleKey = "dashboard" | "deliverables" | "registers" | "notifications" | "chat";

const DEFAULT_MODULES: Record<ModuleKey, boolean> = {
  dashboard: true,
  deliverables: true,
  registers: true,
  notifications: true,
  chat: true,
};

/**
 * Middleware that returns 403 if the calling user's org does not have the
 * specified module enabled in org_config.modules.
 *
 * Fails open (calls next()) when:
 * - The user has no organizationId (system_owner)
 * - The org has no config row (defaults all modules to true)
 * - A DB error occurs
 */
export function requireModule(moduleName: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      next();
      return;
    }

    try {
      const [config] = await db
        .select({ modules: orgConfigTable.modules })
        .from(orgConfigTable)
        .where(eq(orgConfigTable.organizationId, orgId));

      const modules = config?.modules as Record<string, boolean> | null;
      const isEnabled = modules != null
        ? modules[moduleName] !== false
        : DEFAULT_MODULES[moduleName];

      if (!isEnabled) {
        res.status(403).json({
          error: "MODULE_DISABLED",
          message: `The ${moduleName} module is not enabled for your organisation. Please upgrade your plan.`,
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}
