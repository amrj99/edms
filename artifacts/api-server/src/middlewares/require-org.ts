/**
 * requireOrg — middleware that enforces organization membership.
 *
 * Security policy (Phase 0):
 *  - Unauthenticated requests → pass through (requireAuth in each route handles 401)
 *  - system_owner            → pass through (cross-tenant admin, no org by design)
 *  - Authenticated user without organizationId → 403 organization_required
 *  - Authenticated user with organizationId    → pass through
 *
 * Apply to all routes that operate within an org context:
 *   projects, documents, storage, migrations, correspondence, tasks,
 *   dashboard, search, notifications, workflow-engine, etc.
 *
 * Do NOT apply to: /auth, /health, /admin, /public/share, /billing/plans.
 */
import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export function requireOrg(req: Request, res: Response, next: NextFunction): void {
  // Skip unauthenticated requests — each route's requireAuth handles 401.
  if (!req.user) {
    next();
    return;
  }

  // system_owner intentionally operates without an org (cross-tenant administration).
  if (req.user.role === "system_owner") {
    next();
    return;
  }

  // Authenticated non-system_owner users MUST belong to an organization.
  if (!req.user.organizationId) {
    logger.warn(
      {
        userId: req.user.id,
        email: req.user.email,
        role: req.user.role,
        method: req.method,
        path: req.path,
      },
      "[security] organization_required: authenticated user has no organizationId — access denied",
    );
    res.status(403).json({
      error: "organization_required",
      message: "You must belong to an organization to access this resource. Please contact your system administrator.",
    });
    return;
  }

  next();
}
