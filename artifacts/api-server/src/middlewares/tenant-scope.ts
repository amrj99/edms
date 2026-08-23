/**
 * tenant-scope.ts — DEBT-010 ③ per-request wiring (fail-closed).
 *
 *   withTenantRequest  → middleware: for an AUTHENTICATED request, establishes the
 *                        request-scope marker (requestContext) carrying the verified
 *                        tenant identity. Its presence makes the `db` Proxy
 *                        FAIL-CLOSED for the rest of the request: any DB access not
 *                        inside a tenant transaction throws instead of silently
 *                        using the pool (which would run with no RLS context).
 *
 *   withTenant(fn)     → open a SHORT tenant transaction (runInTenantTx) using the
 *                        request's verified identity. Do DB work inside; do external
 *                        I/O (R2 / Resend / filesystem streaming) OUTSIDE, so a
 *                        connection is never held during I/O.
 *
 * The tenant scope derives ONLY from the authenticated session (never a client
 * orgId). Public/unauthenticated routes are not tenant-scoped (no marker → the
 * Proxy keeps pool access for e.g. login/health).
 */
import type { Request, Response, NextFunction } from "express";
import { requestContext, runInTenantTx } from "@workspace/db";
import { isSystemOwner } from "../lib/auth.js";

export function withTenantRequest(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) return next(); // unauthenticated/public → not tenant-scoped
  requestContext.run(
    { userId: user.id, orgId: user.organizationId ?? null, isSystemOwner: isSystemOwner(user) },
    () => next(),
  );
}

/** Run `fn` inside a short tenant transaction bound to the current request's
 *  verified identity. Throws if called outside a tenant request scope. */
export function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error("withTenant() called outside a tenant request scope (no requestContext).");
  }
  return runInTenantTx({ orgId: ctx.orgId, isSystemOwner: ctx.isSystemOwner }, fn);
}
