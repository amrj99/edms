/**
 * project-access.ts — B2 Refactor: shared tenant-isolation primitive.
 *
 * Extracted verbatim from the near-identical router gates in documents.ts
 * (B2.7-FIX) and transmittals.ts (B2.4-FIX) so every project-scoped router
 * enforces access the same way. See ADR "Tenant Isolation & Object-Level
 * Authorization Pattern v1".
 *
 * Mandatory order (the ADR codifies this):
 *   requireAuth → requireProjectAccess → denyPartyDestructive → resolveEffectiveRole → handler
 * i.e. Authentication → Tenant Access → Party Authorization → Role Resolution
 *      → Object Authorization → Mutation.
 *
 * This module ONLY moves existing logic — no behavior, status codes, or
 * messages change.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { requireInt, type ProjectParams } from "../lib/params.js";
import { canAccessProject, type ProjectAccessResult } from "../lib/can-access-project.js";
import { isSystemOwner } from "../lib/auth.js";

/**
 * The resolved project-access context stashed on the request.
 *
 * Derived from the REAL resolver result (the success branch of
 * ProjectAccessResult, minus `allowed`) so it keeps every field canAccessProject
 * exposes now or later — `projectOrgId`, `mode`, `partyRole` — without hand-copying.
 */
export type ProjectAccessCtx = Omit<Extract<ProjectAccessResult, { allowed: true }>, "allowed">;

// Central typing so routes read `req.projectAccess` without local casts.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireProjectAccess(); read via requireProjectAccessContext(). */
      projectAccess?: ProjectAccessCtx;
    }
  }
}

/**
 * Router-wide project-access gate. Proves tenant/project access BEFORE any
 * handler (and before role resolution) — fail-closed 403 for non-members —
 * then stashes the resolved access so downstream party-ceiling checks read it
 * without re-querying.
 *
 * Behaviour is identical to the inline gates it replaces (same 403 body).
 */
export function requireProjectAccess(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const caller = req.user!;
    const projectId = requireInt((req.params as ProjectParams).projectId);
    const access = await canAccessProject(caller.id, caller.organizationId, projectId, isSystemOwner(caller));
    if (!access.allowed) {
      res.status(403).json({ error: "Forbidden", message: "You are not a member of this project" });
      return;
    }
    req.projectAccess = { projectOrgId: access.projectOrgId, mode: access.mode, partyRole: access.partyRole };
    next();
  };
}

/**
 * Fail-closed accessor. Returns the project-access context, or THROWS if the
 * request never passed requireProjectAccess(). A missing context is a wiring
 * bug, not a valid state — a security primitive must never run without it.
 */
export function requireProjectAccessContext(req: Request): ProjectAccessCtx {
  const ctx = req.projectAccess;
  if (!ctx) {
    throw new Error(
      "requireProjectAccessContext: no project-access context on request — " +
      "requireProjectAccess() must run before this handler",
    );
  }
  return ctx;
}

/**
 * Fail-closed party guard for DESTRUCTIVE actions that have no PARTY_CEILING_V1
 * capability (Party Policy v1). Denies party callers (403). If the access
 * context is missing it fails closed (via requireProjectAccessContext throwing)
 * rather than silently calling next().
 *
 * Contract: MUST be mounted after requireProjectAccess().
 */
export const denyPartyDestructive: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const { mode } = requireProjectAccessContext(req);
  if (mode === "party") {
    res.status(403).json({ error: "Forbidden", message: "Your party role does not permit this action" });
    return;
  }
  next();
};
