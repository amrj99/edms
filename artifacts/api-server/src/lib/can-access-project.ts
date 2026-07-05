/**
 * Project access — shared authorization utility (extracted from routes/documents.ts)
 *
 * Provides canAccessProject(): the single function that determines whether a
 * caller (user + org) may access a given project.
 *
 * Access modes (returned as `mode` in the result):
 *   'system'    — system_owner bypass (sees all projects)
 *   'intra_org' — caller's org owns the project
 *   'member'    — explicit project membership (project_members table)
 *   'party'     — caller's org is an active party to the project (Phase 5)
 *
 * The party branch queries project_parties with a project-scoped WHERE.
 * It does NOT use orgScopedWhere — see ADR-011: docs/architecture/ADR-011.md
 *
 * projectOrgId is returned so callers can pass it to the access resolver for
 * org-boundary checks (see routes/documents.ts line 623).
 */

import { db, projectsTable, projectMembersTable, projectPartiesTable } from "@workspace/db";
import type { PartyRole } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

export type AccessMode = "system" | "intra_org" | "member" | "party";

export type ProjectAccessResult =
  | { allowed: false;  projectOrgId: number | null; mode?: undefined; partyRole?: undefined }
  | { allowed: true;   projectOrgId: number | null; mode: AccessMode; partyRole?: PartyRole };

/**
 * Determine whether a caller may access the given project.
 *
 * @param userId     - The authenticated user's ID
 * @param userOrgId  - The authenticated user's organization ID (undefined for system_owner)
 * @param projectId  - The project being accessed
 * @param sysAdmin   - Pass isSystemOwner(caller) from the route
 *
 * Performance: fetches the project once (with collaborationMode), then up to
 * two additional queries (member check, party check) only when needed.
 * Maximum 3 DB round-trips for a cross-org party member.
 */
export async function canAccessProject(
  userId: number,
  userOrgId: number | undefined,
  projectId: number,
  sysAdmin: boolean,
): Promise<ProjectAccessResult> {
  if (sysAdmin) return { allowed: true, projectOrgId: null, mode: "system" };

  const [project] = await db
    .select({
      organizationId:    projectsTable.organizationId,
      collaborationMode: projectsTable.collaborationMode,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return { allowed: false, projectOrgId: null };

  const projectOrgId = project.organizationId ?? null;

  // Intra-org: caller's org owns the project — primary fast path
  if (project.organizationId === userOrgId) {
    return { allowed: true, projectOrgId, mode: "intra_org" };
  }

  // Explicit project membership (cross-org legacy path)
  const [member] = await db
    .select({ userId: projectMembersTable.userId })
    .from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.userId, userId),
    ))
    .limit(1);

  if (member) return { allowed: true, projectOrgId, mode: "member" };

  // Party access path — separate from orgScopedWhere (see ADR-011)
  // Only attempted when project.collaborationMode = 'parties' to avoid
  // unnecessary DB queries for org_only projects.
  if (project.collaborationMode === "parties" && userOrgId) {
    const [party] = await db
      .select({ partyRole: projectPartiesTable.partyRole })
      .from(projectPartiesTable)
      .where(and(
        eq(projectPartiesTable.projectId, projectId),
        eq(projectPartiesTable.organizationId, userOrgId),
        isNull(projectPartiesTable.removedAt),
      ))
      .limit(1);

    if (party) {
      return {
        allowed:    true,
        projectOrgId,
        mode:       "party",
        partyRole:  party.partyRole as PartyRole,
      };
    }
  }

  return { allowed: false, projectOrgId };
}
