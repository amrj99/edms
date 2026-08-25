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
import { requestContext, runInTenantTx, dbContext } from "@workspace/db";
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

/**
 * Context-aware READ helper for DB-reading middlewares/authorization gates that
 * run under the fail-closed marker but outside any withTenant() (e.g. a router-
 * wide `requireProjectAccess()` on a POST/PUT/DELETE, where the read auto-wrapper
 * intentionally does not apply). Resolves to:
 *   • the current tenant tx if one is already open (GET auto-wrap / withTenant), or
 *   • a SHORT read tenant tx when inside a tenant request with no tx (writes), or
 *   • the pool directly when there is no tenant marker (unconverted/public routes).
 * This keeps authorization reads correct without holding a tx across the handler.
 */
export function tenantRead<T>(fn: () => Promise<T>): Promise<T> {
  if (dbContext.getStore()) return fn();               // already inside a tenant tx
  if (requestContext.getStore()) return withTenant(fn); // write under marker → short read tx
  return fn();                                          // no marker → pool (unchanged)
}

/**
 * Run a genuine PLATFORM/bulk operation OUTSIDE the request's tenant scope, on
 * the pool-backed handle (no marker → no fail-closed throw). Use ONLY for real
 * cross-tenant platform work (e.g. full search reindex) — never as a per-request
 * escape for ordinary tenant work.
 *
 * ⚠️ edms_app gate (decision B): under the non-superuser role the pool has NO RLS
 * context, so a pure `runUnscoped` read returns 0 rows. Such platform ops must be
 * refactored to a `withSystemContext` (a tx with is_system_owner=true) that reads
 * under system context and does external I/O OUTSIDE the tx. Tracked for cutover.
 */
export function runUnscoped<T>(fn: () => Promise<T>): Promise<T> {
  return requestContext.exit(fn);
}

// ─── DEBT-010 — per-router mount primitive (leak-free) ────────────────────────
// `tenantScoped(subRouter)` mounts a router under fail-closed tenant scope: it
// establishes the request marker (so bare `db` fails closed — every read/write
// must use an EXPLICIT withTenant()/tenantRead() unit-of-work), runs the
// sub-router, and — crucially — EXITS the tenant scope on fall-through
// (requestContext.exit) so the marker never leaks to a sibling router sharing the
// same mount prefix.
//
// Phase D removed the transitional read auto-wrapper: there is no longer any
// implicit request-spanning read transaction. GET/HEAD handlers open their own
// short tenantRead() unit; streaming/download and external-I/O routes do their DB
// work in a short withTenant() and stream/redirect OUTSIDE it.
//
// Public/unauthenticated requests are never scoped (no marker → the `db` Proxy
// keeps pool access for login/health/registration reads via tenantRead's pool fallback).
export function tenantScoped(
  subRouter: (req: Request, res: Response, next: NextFunction) => void,
) {
  return function tenantScopedMount(req: Request, res: Response, next: NextFunction): void {
    const user = req.user;
    // Unauthenticated: dispatch to the sub-router UNSCOPED (no marker) so its own
    // requireAuth returns 401 — exactly the pre-conversion behaviour. (Returning
    // next() here would skip the router and mis-report 404 for protected routes.)
    if (!user) return subRouter(req, res, next);
    requestContext.run(
      { userId: user.id, orgId: user.organizationId ?? null, isSystemOwner: isSystemOwner(user) },
      () => {
        // On fall-through (this router did not handle the path) or error, LEAVE
        // the tenant scope so downstream routers are unaffected.
        subRouter(req, res, (err?: unknown) => requestContext.exit(() => next(err as never)));
      },
    );
  };
}
