/**
 * tenant-guards.ts — DEBT-009 shared tenant-isolation guard.
 *
 * Several by-id / nested routes historically looked a resource up by its ID (or a
 * path :projectId) WITHOUT verifying it belongs to the caller's organization,
 * allowing cross-tenant IDOR. This guard centralises the correct check so callers
 * don't hand-roll (and forget) it.
 *
 * assertProjectAccess() delegates to the already-trusted canAccessProject() — which
 * grants system_owner global access, intra-org access, and cross-org access ONLY via
 * an explicit project membership / party relationship. It NEVER trusts a
 * client-supplied orgId. On failure it writes the 403/404 response and returns
 * false, so the handler just does `if (!(await assertProjectAccess(req,res,pid))) return;`.
 */
import type { Request, Response } from "express";
import { canAccessProject } from "./can-access-project.js";
import { isSystemOwner } from "./auth.js";
import { tenantRead } from "../middlewares/tenant-scope.js";

/**
 * Returns true if the caller may access `projectId` (system_owner, owning org, or
 * explicit member/party). Otherwise sends 403 and returns false.
 * Pass `notFoundOnDeny: true` to respond 404 instead of 403 (avoids leaking the
 * existence of another tenant's project for pure READ routes).
 */
export async function assertProjectAccess(
  req: Request,
  res: Response,
  projectId: number,
  opts: { notFoundOnDeny?: boolean } = {},
): Promise<boolean> {
  const user = req.user!;
  // tenantRead: reuse the active tenant tx if any (inside withTenant / GET auto-wrap),
  // else open a SHORT read tx under the marker (writes), else pool (unconverted).
  const { allowed } = await tenantRead(() => canAccessProject(user.id, user.organizationId, projectId, isSystemOwner(user)));
  if (!allowed) {
    if (opts.notFoundOnDeny) res.status(404).json({ error: "Not Found" });
    else res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}
