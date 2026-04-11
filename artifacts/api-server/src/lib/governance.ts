/**
 * Governance helpers — delegation and project role override resolution.
 *
 * Use resolveEffectiveRole() in routes wherever canAct logic depends on a
 * user's role. It returns the highest-privilege role available to the caller
 * in the given project context, considering:
 *   1. Active project role overrides (time-bound, project-scoped elevation)
 *   2. Active delegations (acting on behalf of another user)
 *   3. Base org role (fallback)
 */

import { db } from "@workspace/db";
import { delegationsTable, projectRoleOverridesTable, usersTable } from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import type { AuthUser } from "./auth.js";

const ROLE_RANK: Record<string, number> = {
  system_owner: 100,
  admin: 80,
  project_manager: 60,
  document_controller: 40,
  reviewer: 20,
  viewer: 0,
};

function higherRole(a: string, b: string): string {
  return (ROLE_RANK[a] ?? 0) >= (ROLE_RANK[b] ?? 0) ? a : b;
}

/**
 * Returns the best active project role override for this user on this project.
 * Returns null if none is active / not expired.
 */
export async function getProjectRoleOverride(
  userId: number,
  projectId: number,
): Promise<string | null> {
  const now = new Date();
  const [override] = await db
    .select({ roleOverride: projectRoleOverridesTable.roleOverride })
    .from(projectRoleOverridesTable)
    .where(
      and(
        eq(projectRoleOverridesTable.userId, userId),
        eq(projectRoleOverridesTable.projectId, projectId),
        eq(projectRoleOverridesTable.isActive, true),
        gt(projectRoleOverridesTable.expiresAt, now),
      ),
    )
    .orderBy(projectRoleOverridesTable.expiresAt)
    .limit(1);
  return override?.roleOverride ?? null;
}

/**
 * Returns the from-user's role if the given user has an active delegation
 * covering this project (or is org-wide). Returns null otherwise.
 */
export async function getActiveDelegation(
  userId: number,
  organizationId: number,
  projectId?: number,
): Promise<{ fromUserRole: string; fromUserId: number; delegationId: number } | null> {
  const now = new Date();

  const rows = await db
    .select({
      id: delegationsTable.id,
      fromUserId: delegationsTable.fromUserId,
      projectId: delegationsTable.projectId,
    })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.toUserId, userId),
        eq(delegationsTable.organizationId, organizationId),
        eq(delegationsTable.isActive, true),
        gt(delegationsTable.expiresAt, now),
        projectId
          ? or(isNull(delegationsTable.projectId), eq(delegationsTable.projectId, projectId))
          : isNull(delegationsTable.projectId),
      ),
    )
    .limit(10);

  if (rows.length === 0) return null;

  // Pick the most specific delegation (project-specific beats org-wide)
  const specific = rows.find(r => r.projectId !== null);
  const chosen = specific ?? rows[0];

  const [fromUser] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, chosen.fromUserId))
    .limit(1);

  if (!fromUser) return null;
  return { fromUserRole: fromUser.role, fromUserId: chosen.fromUserId, delegationId: chosen.id };
}

/**
 * Main entry point. Returns the effective role of the caller in the given
 * project context, considering delegations and project role overrides.
 *
 * Pass projectId when doing project-scoped permission checks.
 */
export async function resolveEffectiveRole(
  caller: AuthUser,
  projectId?: number,
): Promise<{ role: string; isDelegating: boolean; delegatedFromUserId?: number; delegationId?: number }> {
  let role = caller.role;
  let isDelegating = false;
  let delegatedFromUserId: number | undefined;
  let delegationId: number | undefined;

  // 1. Check project role override (elevates role within this project)
  if (projectId) {
    const override = await getProjectRoleOverride(caller.id, projectId);
    if (override) {
      role = higherRole(role, override);
    }
  }

  // 2. Check active delegation (caller acts on behalf of someone else)
  if (caller.organizationId) {
    const delegation = await getActiveDelegation(caller.id, caller.organizationId, projectId);
    if (delegation) {
      const delegatedRole = higherRole(role, delegation.fromUserRole);
      if (delegatedRole !== role) {
        role = delegatedRole;
        isDelegating = true;
        delegatedFromUserId = delegation.fromUserId;
        delegationId = delegation.delegationId;
      }
    }
  }

  return { role, isDelegating, delegatedFromUserId, delegationId };
}

/**
 * Convenience: returns true if the caller has at least the given minimum role
 * in the given project context (considering overrides and delegations).
 */
export async function callerHasRole(
  caller: AuthUser,
  minRole: string,
  projectId?: number,
): Promise<boolean> {
  const { role } = await resolveEffectiveRole(caller, projectId);
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}
