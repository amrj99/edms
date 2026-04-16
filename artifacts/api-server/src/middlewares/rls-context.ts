import { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isSystemOwner } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

/**
 * PostgreSQL RLS session context middleware.
 *
 * Sets `app.current_org_id` in the current DB session so that RLS policies
 * on critical tables can filter rows by organization.
 *
 *   - system_owner  → '' (empty string) → policy treats as "no restriction"
 *   - org user      → orgId as string
 *   - unauthenticated → skipped (public routes are not org-scoped)
 *
 * ⚠️  Connection-pool caveat:
 *   `set_config(..., FALSE)` sets a session-level variable on whichever
 *   connection the pool allocates for this particular `db.execute()` call.
 *   Subsequent queries in the same request may land on a different pool
 *   connection and therefore see a stale or unset value.
 *
 *   RLS is therefore a defence-in-depth layer here, NOT the primary isolation
 *   mechanism. Primary isolation is enforced at the application level via
 *   `requireOrgScope` + `assertOrgMatch`.
 *
 *   A full per-request transaction wrapper (SET LOCAL inside BEGIN/COMMIT)
 *   would remove this limitation at the cost of refactoring every route.
 */
export async function setRlsContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next();

  const value = isSystemOwner(req.user) ? "" : String(req.user.organizationId ?? "");

  try {
    await db.execute(sql`SELECT set_config('app.current_org_id', ${value}, FALSE)`);
  } catch (err) {
    logger.warn({ err }, "RLS ctx: set_config failed — continuing without DB-session context");
  }

  next();
}
