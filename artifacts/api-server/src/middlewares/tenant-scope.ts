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

// ─── DEBT-010 Hybrid-Y — transitional read auto-wrapper ───────────────────────
// WRITE handlers must use withTenant() explicitly (fail-closed forces it). READ
// handlers (GET/HEAD) not yet migrated to explicit withTenant() are covered by
// this middleware: it opens a SHORT read tenant transaction for the request so
// the `db` Proxy resolves to it (no fail-closed throw) with the correct RLS
// context. Every route it wraps is recorded for the Phase-D migration inventory.
//
// STRICT limits (mirroring the user's Hybrid-Y contract):
//   • GET/HEAD only — never a mutating method.
//   • The route MUST be read-only with NO external I/O (R2 / Resend / fs stream).
//     Routers with streaming downloads pass a `skip` predicate to EXCLUDE those
//     paths (they hold no tx during I/O — they use withTenant() for the metadata
//     lookup and stream OUTSIDE it).
//   • The transaction spans the request; keep read handlers short.
//
// This is TRANSITIONAL. Phase D migrates these reads to explicit withTenant()
// and this wrapper is removed.

const autoWrappedReads = new Set<string>();

/** Inventory of read routes served through the transitional auto-wrapper this
 *  process. Used by tests/reporting to track the Phase-D migration surface. */
export function getAutoWrappedReadInventory(): string[] {
  return [...autoWrappedReads].sort();
}

/**
 * Build a read auto-wrapper for a router. `skip(req)` returns true for routes
 * that must NOT be transaction-wrapped (streaming downloads / external I/O).
 */
export function makeReadAutoWrap(skip?: (req: Request) => boolean) {
  return function readAutoWrap(req: Request, res: Response, next: NextFunction): void {
    const ctx = requestContext.getStore();
    if (!ctx) return next();                       // not tenant-scoped (public)
    if (dbContext.getStore()) return next();       // already inside a tenant tx
    const m = req.method.toUpperCase();
    if (m !== "GET" && m !== "HEAD") return next(); // writes → explicit withTenant()
    if (skip?.(req)) return next();                 // streaming / external-I/O route

    autoWrappedReads.add(`${m} ${req.baseUrl}${req.path}`);
    void runInTenantTx({ orgId: ctx.orgId, isSystemOwner: ctx.isSystemOwner }, () =>
      new Promise<void>((resolve) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        next();
      }),
    ).catch((err) => { if (!res.headersSent) next(err); });
  };
}

/** Default read auto-wrapper (no exclusions) — for routers without streaming. */
export const readAutoWrap = makeReadAutoWrap();
