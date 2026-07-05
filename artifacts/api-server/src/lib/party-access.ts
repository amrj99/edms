/**
 * Party access — cross-org project authorization (Phase 5, Party Model Minimum)
 *
 * This module is the ONLY authorized path for cross-org resource access.
 * See ADR-011: docs/architecture/ADR-011.md
 *
 * Rule: orgScopedWhere() enforces intra-org isolation and is never modified
 * for cross-org scenarios. Cross-org access flows through canAccessProjectAsParty()
 * and project-scoped WHERE clauses.
 */

import { db, projectsTable, projectPartiesTable } from "@workspace/db";
import type { PartyRole } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

export type { PartyRole };

export type PartyAccessResult =
  | { allowed: false; partyRole?: undefined }
  | { allowed: true; partyRole: PartyRole };

/**
 * Standalone party access check — fetches project and party record independently.
 *
 * Use this from routes that need to verify party access without going through
 * canAccessProject() (e.g., party management endpoints in Phase C).
 *
 * For the combined intra-org + party check, use canAccessProject() in
 * lib/can-access-project.ts — it avoids double project fetch.
 *
 * Returns { allowed: false } when:
 *   - organizationId is null/undefined (unauthenticated or no org)
 *   - project does not exist
 *   - project.collaborationMode !== 'parties'
 *   - no active party record (removed_at IS NOT NULL or record absent)
 */
export async function canAccessProjectAsParty(
  organizationId: number | null | undefined,
  projectId: number,
): Promise<PartyAccessResult> {
  if (!organizationId) return { allowed: false };

  const [project] = await db
    .select({ collaborationMode: projectsTable.collaborationMode })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project || project.collaborationMode !== "parties") return { allowed: false };

  const [party] = await db
    .select({ partyRole: projectPartiesTable.partyRole })
    .from(projectPartiesTable)
    .where(and(
      eq(projectPartiesTable.projectId, projectId),
      eq(projectPartiesTable.organizationId, organizationId),
      isNull(projectPartiesTable.removedAt),
    ))
    .limit(1);

  if (!party) return { allowed: false };
  return { allowed: true, partyRole: party.partyRole as PartyRole };
}
