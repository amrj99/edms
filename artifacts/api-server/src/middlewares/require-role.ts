/**
 * require-role.ts — Declarative authorization middlewares
 *
 * These are the ONLY sanctioned ways to enforce role-based access in route
 * handlers. All scattered `if (user.role !== "admin")` checks should be
 * replaced with one of these helpers.
 *
 * ─── Hierarchy (highest → lowest) ────────────────────────────────────────────
 *   system_owner (100) > admin (80) > project_manager (60)
 *   > document_controller (40) > reviewer (20) > member (10) > viewer (0)
 *
 * ─── Choosing the right helper ────────────────────────────────────────────────
 *
 *  requireMinRole("admin")
 *    → caller must have rank >= admin (i.e. admin OR system_owner)
 *    → use for: config changes, user management, delete operations
 *
 *  requireMinRole("project_manager")
 *    → caller must have rank >= project_manager
 *    → use for: project creation, member management, task assignment
 *
 *  requireExactRoles("system_owner")
 *    → caller must be EXACTLY one of the listed roles
 *    → use for: cross-tenant platform operations (billing, global config)
 *    → same as the original requireRole() in auth.ts
 *
 *  requireAdminOrSelf(getTargetUserId)
 *    → caller must be admin+ OR the user themselves
 *    → use for: profile edits, password changes, preference updates
 *
 * ─── system_owner bypass ──────────────────────────────────────────────────────
 *  system_owner always passes requireMinRole checks regardless of the threshold,
 *  because they are the platform-level super-admin. This mirrors the existing
 *  behaviour of isSysAdmin() and isSystemOwner() throughout the codebase.
 *
 * ─── Error format ─────────────────────────────────────────────────────────────
 *  All denials use ForbiddenError so they flow through the global error handler,
 *  get logged at warn level, and are reported with a consistent error code.
 */

import type { Request, Response, NextFunction } from "express";
import { isAtLeast, type AppRole } from "../lib/permissions.js";
import { ForbiddenError } from "../lib/errors.js";

// ─── requireMinRole ────────────────────────────────────────────────────────────

/**
 * Middleware: caller's effective role must be >= minRole in the role hierarchy.
 *
 * system_owner always passes (rank 100).
 *
 * @example
 *   router.post("/", requireAuth, requireMinRole("admin"), handler)
 *   router.delete("/:id", requireAuth, requireMinRole("project_manager"), handler)
 */
export function requireMinRole(minRole: AppRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new ForbiddenError("Authentication required"));
      return;
    }
    if (!isAtLeast(user.role, minRole)) {
      next(
        new ForbiddenError(
          `Insufficient permissions — requires ${minRole} or above`,
          { requiredRole: minRole, actualRole: user.role },
        ),
      );
      return;
    }
    next();
  };
}

// ─── requireExactRoles ─────────────────────────────────────────────────────────

/**
 * Middleware: caller's role must exactly match one of the listed roles.
 * Use only when you need to exclude roles that rank higher (e.g. system_owner
 * should NOT access an org-scoped endpoint). For most cases, requireMinRole
 * is the better choice because it automatically includes higher-ranked roles.
 *
 * @example
 *   // Only org admins — system_owner uses a different path
 *   router.get("/org-settings", requireAuth, requireExactRoles("admin"), handler)
 */
export function requireExactRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new ForbiddenError("Authentication required"));
      return;
    }
    if (!roles.includes(user.role)) {
      next(
        new ForbiddenError(
          `Insufficient permissions — requires one of: ${roles.join(", ")}`,
          { requiredRoles: roles, actualRole: user.role },
        ),
      );
      return;
    }
    next();
  };
}

// ─── requireAdminOrSelf ────────────────────────────────────────────────────────

/**
 * Middleware factory: caller must be admin+ OR the resource owner themselves.
 *
 * Pass a function that extracts the target user ID from the request.
 * Returns 403 if neither condition is met.
 *
 * @example
 *   router.put("/:id", requireAuth, requireAdminOrSelf(req => Number(req.params.id)), handler)
 *   router.delete("/:id", requireAuth, requireAdminOrSelf(req => Number(req.params.id)), handler)
 */
export function requireAdminOrSelf(getTargetUserId: (req: Request) => number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new ForbiddenError("Authentication required"));
      return;
    }
    const targetId = getTargetUserId(req);
    const isSelf = user.id === targetId;
    const isAdmin = isAtLeast(user.role, "admin");
    if (!isSelf && !isAdmin) {
      next(
        new ForbiddenError(
          "You can only modify your own resources, or you need admin privileges",
          { targetUserId: targetId, actualRole: user.role },
        ),
      );
      return;
    }
    next();
  };
}

// ─── requireSysOwner ──────────────────────────────────────────────────────────

/**
 * Middleware: caller must be system_owner.
 * Convenience alias — equivalent to requireExactRoles("system_owner").
 * Use for cross-tenant platform operations only.
 *
 * @example
 *   router.get("/all-orgs", requireAuth, requireSysOwner, handler)
 */
export function requireSysOwner(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    next(new ForbiddenError("Authentication required"));
    return;
  }
  if (user.role !== "system_owner") {
    next(
      new ForbiddenError(
        "System owner access required",
        { actualRole: user.role },
      ),
    );
    return;
  }
  next();
}

// ─── hasMinRole (non-middleware helper) ───────────────────────────────────────

/**
 * Pure boolean check — use inside route handlers where you need conditional
 * logic rather than a hard gate.
 *
 * @example
 *   const canSeeAll = hasMinRole(req.user, "project_manager");
 *   const docs = canSeeAll ? await getAllDocs(orgId) : await getMyDocs(userId);
 */
export function hasMinRole(user: { role: string }, minRole: AppRole): boolean {
  return isAtLeast(user.role, minRole);
}

/**
 * Pure boolean check for exact role membership.
 *
 * @example
 *   if (hasAnyRole(req.user, ["admin", "system_owner"])) { ... }
 */
export function hasAnyRole(user: { role: string }, roles: string[]): boolean {
  return roles.includes(user.role);
}
