/**
 * Organization Scoping — Middleware and Query Helpers
 *
 * Tenant isolation has two shapes. Use the right tool for each:
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SHAPE 1 — Scoped mutation (one DB round-trip, preferred)               │
 * │                                                                         │
 * │   const filter = orgScopedWhere(caller, table.id, id, table.orgId);   │
 * │   const [row] = await db.update(table).set({…}).where(filter)          │
 * │                  .returning();                                          │
 * │   if (!row) { res.status(404).json(…); return; }  // not found OR      │
 * │                                                    // cross-org (same) │
 * │                                                                         │
 * │   Cross-org requests see "Not Found" — indistinguishable from a        │
 * │   missing ID, which leaks no information about other tenants.          │
 * │                                                                         │
 * │ SHAPE 2 — Check-after-fetch (for cross-table / no direct org column)  │
 * │                                                                         │
 * │   const [row] = await db.select(…).where(eq(table.id, id)).limit(1);  │
 * │   if (!row) { res.status(404).json(…); return; }                       │
 * │   if (!assertOrgMatch(req, res, row.organizationId)) return;           │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * SECURITY RULE: every UPDATE and DELETE on a tenant-owned table MUST use
 * one of these two shapes. A bare `eq(table.id, id)` without an org filter
 * is a tenant isolation violation.
 *
 * Cross-org access (Party Model and beyond) belongs in lib/party-access.ts —
 * never here. See ADR-011: docs/architecture/ADR-011.md
 */

import { and, eq, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { Request, Response, NextFunction } from "express";
import { isSystemOwner } from "./auth.js";
import { createAuditLog } from "./audit.js";

declare global {
  namespace Express {
    interface Request {
      /** Resolved organization ID for the current request.
       *  Set for all authenticated users (including system_owner with orgOverride).
       *  Undefined for system_owner with no override — they see all orgs. */
      orgId?: number;
    }
  }
}

// ─── Shape 1: Scoped WHERE clause ────────────────────────────────────────────

/**
 * Build a tenant-scoped WHERE clause for Drizzle UPDATE/DELETE queries.
 *
 * system_owner → idColumn = id               (sees all orgs)
 * all others   → idColumn = id
 *                AND orgColumn = caller.organizationId
 *
 * Returns "Not Found" for cross-org requests — safe information leakage.
 *
 * @param caller   - The authenticated JWT payload (req.user)
 * @param idColumn - The primary key column (e.g. table.id)
 * @param id       - The resource ID from the request
 * @param orgColumn - The organization FK column (e.g. table.organizationId)
 */
export function orgScopedWhere(
  caller: { role: string; organizationId?: number | null },
  idColumn: AnyColumn,
  id: number,
  orgColumn: AnyColumn,
): SQL {
  if (caller.role === "system_owner") return eq(idColumn, id);
  return and(eq(idColumn, id), eq(orgColumn, caller.organizationId!)) as SQL;
}

// ─── Shape 2: Check-after-fetch ───────────────────────────────────────────────

/**
 * Assert that a fetched resource belongs to the requesting user's organization.
 *
 * Returns true  → caller may proceed.
 * Returns false → 403 already written to res; caller must `return` immediately.
 *
 * system_owner always returns true (not org-scoped).
 *
 * Prefer orgScopedWhere() when the resource has a direct organizationId column
 * and you are doing a single mutation — it avoids the extra SELECT round-trip.
 *
 * Use assertOrgMatch() when:
 *   • The org is determined through a JOIN (e.g. project → org)
 *   • You need to fetch the row regardless (e.g. to return it in the response)
 */
export function assertOrgMatch(
  req: Request,
  res: Response,
  resourceOrgId: number | null | undefined,
): boolean {
  const user = req.user!;

  if (isSystemOwner(user)) return true;

  if (!resourceOrgId || resourceOrgId !== user.organizationId) {
    res.status(403).json({
      error: "Forbidden",
      message: "Cross-organization access denied.",
    });
    return false;
  }

  return true;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

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

  if (!orgId && !isSystemOwner(user)) {
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
 * Get the effective org ID from the request.
 * For system_owner this may be undefined (they span all orgs).
 * For all other users it is their organizationId.
 */
export function getReqOrgId(req: Request): number | undefined {
  return req.orgId ?? req.user?.organizationId ?? undefined;
}
