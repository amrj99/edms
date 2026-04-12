/**
 * Governance helpers — delegation and project role override resolution.
 *
 * Use resolveEffectiveRole() in routes wherever canAct logic depends on a
 * user's role. It returns the highest-privilege role available to the caller
 * in the given project context, considering (in order):
 *   1. Project member role  (per-project role stored in project_members)
 *   2. Active project role overrides (time-bound, project-scoped elevation)
 *   3. Active delegations (acting on behalf of another user)
 *   4. Base org role (fallback)
 *
 * Privilege escalation is prevented:
 *   - Delegations cannot grant more than the delegator's own effective role.
 *   - Role overrides to system_owner can only be granted by system_owner.
 */

import { db } from "@workspace/db";
import { delegationsTable, projectRoleOverridesTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import type { AuthUser } from "./auth.js";
import { ROLE_RANK } from "./permissions.js";

export { ROLE_RANK };

function higherRole(a: string, b: string): string {
  return (ROLE_RANK[a] ?? 0) >= (ROLE_RANK[b] ?? 0) ? a : b;
}

/**
 * Returns the user's explicit project-member role for this project, if any.
 * Returns null if the user has no project_members row for this project.
 */
export async function getProjectMemberRole(
  userId: number,
  projectId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.userId, userId),
        eq(projectMembersTable.projectId, projectId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
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

export interface ResolvedRole {
  /** The highest effective role after all layers of resolution */
  role: string;
  /** True when the caller is acting under an active delegation */
  isDelegating: boolean;
  /** The user they are acting on behalf of (when delegating) */
  delegatedFromUserId?: number;
  /** The delegation record ID (when delegating) */
  delegationId?: number;
  /** True when the effective role came from a project_members override */
  hasProjectMemberRole: boolean;
  /** True when the effective role came from a project_role_override */
  hasRoleOverride: boolean;
}

/**
 * Main entry point. Returns the effective role of the caller in the given
 * project context, considering:
 *  1. Project member role (project_members table)
 *  2. Active project role override (time-bound elevation)
 *  3. Active delegation (acting on behalf of another user)
 *  4. Base org role (the user's own role on their account)
 *
 * The highest role across all active sources wins.
 *
 * Pass projectId when doing project-scoped permission checks.
 */
export async function resolveEffectiveRole(
  caller: AuthUser,
  projectId?: number,
): Promise<ResolvedRole> {
  let role = caller.role;
  let isDelegating = false;
  let delegatedFromUserId: number | undefined;
  let delegationId: number | undefined;
  let hasProjectMemberRole = false;
  let hasRoleOverride = false;

  if (projectId) {
    // 1. Project member role
    const memberRole = await getProjectMemberRole(caller.id, projectId);
    if (memberRole) {
      const elevated = higherRole(role, memberRole);
      if (elevated !== role) hasProjectMemberRole = true;
      role = elevated;
    }

    // 2. Project role override (time-bound elevation)
    const override = await getProjectRoleOverride(caller.id, projectId);
    if (override) {
      const elevated = higherRole(role, override);
      if (elevated !== role) hasRoleOverride = true;
      role = elevated;
    }
  }

  // 3. Active delegation (caller acts on behalf of someone else)
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

  return { role, isDelegating, delegatedFromUserId, delegationId, hasProjectMemberRole, hasRoleOverride };
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
