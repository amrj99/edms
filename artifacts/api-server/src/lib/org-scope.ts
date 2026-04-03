/**
 * Organization Scoping Middleware
 *
 * Enforces tenant isolation at the middleware level so individual routes
 * do not need to repeat manual org checks.
 *
 * Usage in routes:
 *   router.get("/", requireAuth, requireOrgScope, async (req, res) => {
 *     const orgId = req.orgId!;          // guaranteed non-null for non-sysadmin
 *     // use assertOrgMatch to guard resource access:
 *     if (!assertOrgMatch(req, res, resource.organizationId)) return;
 *   });
 */

import { Request, Response, NextFunction } from "express";
import { isSysAdmin } from "./auth.js";
import { createAuditLog } from "./audit.js";

declare global {
  namespace Express {
    interface Request {
      /** Resolved organization ID for the current request.
       *  Set for all authenticated users (including system_owner with orgOverride).
       *  Null for system_owner with no override — they see all orgs. */
      orgId?: number;
    }
  }
}

/**
 * Middleware: resolve and attach req.orgId from the authenticated user.
 * Blocks non-system-owner users who have no organization assigned.
 * Must be used after requireAuth.
 *
 * When a system_owner uses the orgOverride query parameter, the override is
 * recorded in the audit log for compliance traceability.
 */
export function requireOrgScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orgId = user.organizationId;

  if (!orgId && !isSysAdmin(user)) {
    res.status(403).json({
      error: "Forbidden",
      message: "Your account has no organization assigned. Contact a system administrator.",
    });
    return;
  }

  req.orgId = orgId ?? undefined;

  // Audit system_owner org-override usage for compliance
  if (user.role === "system_owner") {
    const override = req.query.orgOverride;
    if (override && !isNaN(Number(override))) {
      const overrideOrgId = Number(override);
      // Fire-and-forget — must not block the request
      createAuditLog({
        userId: user.id,
        organizationId: overrideOrgId,
        action: "system_owner_org_override",
        entityType: "organization",
        entityId: overrideOrgId,
        details: {
          path: req.path,
          method: req.method,
          overrideOrgId,
          originalOrgId: user.organizationId ?? null,
        },
      }).catch(() => {});
    }
  }

  next();
}

/**
 * Assert that a resource belongs to the requesting user's organization.
 * Returns true if the check passes (caller may proceed).
 * Returns false and writes a 403 response if the check fails (caller must return immediately).
 *
 * system_owner always passes — they are not org-scoped.
 *
 * Example:
 *   const doc = await fetchDoc(id);
 *   if (!assertOrgMatch(req, res, doc.organizationId)) return;
 */
export function assertOrgMatch(
  req: Request,
  res: Response,
  resourceOrgId: number | null | undefined,
): boolean {
  const user = req.user!;

  if (isSysAdmin(user)) return true;

  if (!resourceOrgId || resourceOrgId !== user.organizationId) {
    res.status(403).json({
      error: "Forbidden",
      message: "Cross-organization access denied.",
    });
    return false;
  }

  return true;
}

/**
 * Get the effective org ID from the request.
 * For system_owner this may be undefined (they span all orgs).
 * For all other users it is their organizationId.
 */
export function getReqOrgId(req: Request): number | undefined {
  return req.orgId ?? req.user?.organizationId ?? undefined;
}
