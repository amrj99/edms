import { useAuth } from "@/lib/auth";

/**
 * Frontend mirror of the backend permission model.
 *
 * Role hierarchy (highest → lowest):
 *   system_owner(100) > admin(80) > project_manager(60)
 *   > document_controller(40) > reviewer(20) > member(10) > viewer(0)
 *
 * Effective role = max(org role, project-member role, active override, active delegation).
 * For UI purposes, pass the project member role for the current user when available.
 * The hook picks whichever rank is higher.
 *
 * Assignment-based actions (workflow approvals, transmittal review codes) are NOT
 * purely role-gated — the caller must also be formally assigned to the step/item.
 * Use canSetReviewCode(isAssigned) / canCompleteReview(isAssigned) for those.
 */

const ROLE_RANK: Record<string, number> = {
  system_owner: 100,
  admin: 80,
  project_manager: 60,
  document_controller: 40,
  reviewer: 20,
  member: 10,
  viewer: 0,
};

export function rankOf(role: string): number {
  return ROLE_RANK[role] ?? -1;
}

function isAtLeast(role: string, minRole: string): boolean {
  return rankOf(role) >= rankOf(minRole);
}

function resolveEffectiveRole(orgRole: string | undefined, projectRole?: string | undefined): string {
  const base = orgRole ?? "viewer";
  if (!projectRole) return base;
  return rankOf(base) >= rankOf(projectRole) ? base : projectRole;
}

export function usePermissions(projectMemberRole?: string | undefined) {
  const { user } = useAuth();
  const role = resolveEffectiveRole(user?.role, projectMemberRole);

  return {
    /** The resolved effective role string — use for bespoke checks */
    effectiveRole: role,

    // ── Correspondence ───────────────────────────────────────────────────────

    /** Member+ can create and reply to correspondence */
    canCreateCorrespondence: isAtLeast(role, "member"),
    canReply: isAtLeast(role, "member"),

    /** DC+ can close or archive threads */
    canCloseCorrespondence: isAtLeast(role, "document_controller"),

    /** Admin+ can hard-delete correspondence */
    canDeleteCorrespondence: isAtLeast(role, "admin"),

    /** DC+ get an opt-in "view all" toggle in project context */
    hasViewAllCapability: isAtLeast(role, "document_controller"),

    // ── Documents ────────────────────────────────────────────────────────────

    /** DC+ can upload / create documents */
    canCreateDocument: isAtLeast(role, "document_controller"),

    /** DC+ can edit document metadata and revisions */
    canEditDocument: isAtLeast(role, "document_controller"),

    /** DC+ can change document status */
    canChangeDocumentStatus: isAtLeast(role, "document_controller"),

    /**
     * Delete is status-gated:
     *  draft / under_review → DC+ or creator
     *  approved / issued / archived / obsolete → admin+ with mandatory reason
     */
    canDeleteDocumentUnlocked: isAtLeast(role, "document_controller"),
    canDeleteDocumentLocked: isAtLeast(role, "admin"),

    /** DC+ can submit a document into a review workflow */
    canSubmitForWorkflow: isAtLeast(role, "document_controller"),

    // ── Transmittals ─────────────────────────────────────────────────────────

    /** DC+ can create transmittals */
    canCreateTransmittal: isAtLeast(role, "document_controller"),

    /** DC+ can send transmittals */
    canSendTransmittal: isAtLeast(role, "document_controller"),

    /**
     * Setting review codes is ASSIGNMENT-BASED.
     * Pass isAssigned=true when the current user is the designated toUser / createdBy.
     * Admin+ can always override (and it is audit-logged on the backend).
     */
    canSetReviewCode: (isAssigned: boolean): boolean =>
      isAtLeast(role, "admin") || (isAssigned && isAtLeast(role, "reviewer")),

    /**
     * Completing a review cycle is also ASSIGNMENT-BASED.
     * DC+ must be formally responsible for the transmittal.
     */
    canCompleteReview: (isAssigned: boolean): boolean =>
      isAtLeast(role, "admin") || (isAssigned && isAtLeast(role, "document_controller")),

    /** Direct transmittal approve/reject is admin-override only */
    canAdminOverrideTransmittal: isAtLeast(role, "admin"),

    // ── Management ───────────────────────────────────────────────────────────

    isAdmin: isAtLeast(role, "admin"),
    isSysAdmin: isAtLeast(role, "system_owner"),
  };
}
