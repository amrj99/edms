/**
 * ArcScale EDMS — Centralised Permission Matrix
 *
 * This is the single source of truth for what each role can do.
 * All route-level permission checks should use the helpers exported here.
 *
 * ─── Authorization Entry Points ───────────────────────────────────────────────
 *
 * For route-level middleware (Express middleware chain), use:
 *   middlewares/require-role.ts
 *     • requireMinRole(minRole)      — caller rank >= minRole (preferred for most routes)
 *     • requireExactRoles(...roles)  — caller is exactly one of the listed roles
 *     • requireAdminOrSelf(fn)       — admin+ OR the user themselves
 *     • requireSysOwner              — cross-tenant platform operations only
 *     • hasMinRole(user, minRole)    — boolean helper for conditional logic inside handlers
 *     • hasAnyRole(user, roles)      — boolean helper for multi-role conditionals
 *
 * For domain-level permission logic (documents, correspondence, tasks, etc.),
 * use the Permission objects defined in THIS file:
 *     • DocumentPermissions.canDelete(role, status)
 *     • CorrespondencePermissions.canClose(role)
 *     • TaskPermissions.canAssign(role)
 *     • etc.
 *
 * ─── Anti-pattern to avoid ────────────────────────────────────────────────────
 *
 *   ❌  if (user.role === "admin" || user.role === "system_owner") { ... }
 *   ❌  if (["admin", "project_manager"].includes(user.role)) { ... }
 *   ✅  requireMinRole("admin")                    — in middleware chain
 *   ✅  hasMinRole(req.user, "admin")              — inside handler body
 *   ✅  DocumentPermissions.canDelete(role, status) — domain permission
 *
 * ─── Role hierarchy (highest → lowest) ───────────────────────────────────────
 *   system_owner (100) > admin (80) > project_manager (60)
 *   > document_controller (40) > reviewer (20) > member (10) > viewer (0)
 *
 * Effective role resolution (use resolveEffectiveRole from governance.ts):
 *   max( org_role, project_member_role, active_override, active_delegation )
 *
 * Key policy invariants:
 *  1. Workflow/review approvals are assignment-based, not role-based.
 *     hasAssignmentBasedPermission() enforces this for approve/review actions.
 *  2. Document deletion is status-gated:
 *     DC can delete in draft/under_review; admin+ can delete anything (with reason).
 *  3. Correspondence visibility defaults to mail-based (To/CC only).
 *     PM and DC may opt-in to "view all project correspondence" via capability flag.
 *  4. Delegations cannot escalate beyond the delegator's own effective role.
 *  5. Admin-override actions must be audit-logged with explicit reason.
 */

// ─── Role Rank ─────────────────────────────────────────────────────────────

export const ROLE_RANK: Record<string, number> = {
  system_owner: 100,
  admin: 80,
  project_manager: 60,
  document_controller: 40,
  reviewer: 20,
  member: 10,
  viewer: 0,
};

export const ALL_ROLES = [
  "system_owner",
  "admin",
  "project_manager",
  "document_controller",
  "reviewer",
  "member",
  "viewer",
] as const;

export type AppRole = (typeof ALL_ROLES)[number];

/** Roles assignable at org level (by admin+) */
export const ORG_ASSIGNABLE_ROLES: AppRole[] = [
  "admin",
  "project_manager",
  "document_controller",
  "reviewer",
  "member",
  "viewer",
];

/** Roles assignable at project level (by PM+) */
export const PROJECT_ASSIGNABLE_ROLES: AppRole[] = [
  "project_manager",
  "document_controller",
  "reviewer",
  "member",
  "viewer",
];

/** Document statuses where document_controller may delete */
export const DC_DELETABLE_STATUSES = ["draft", "under_review"] as const;

/** Document statuses that are "locked" — require admin+ with override reason */
export const LOCKED_DOC_STATUSES = ["approved", "issued", "archived", "obsolete"] as const;

export function rankOf(role: string): number {
  return ROLE_RANK[role] ?? -1;
}

export function isAtLeast(role: string, minRole: AppRole): boolean {
  return rankOf(role) >= rankOf(minRole);
}

// ─── Document Permissions ──────────────────────────────────────────────────

export const DocumentPermissions = {
  /** Any authenticated user in the project can view */
  canView(_role: string): boolean {
    return true;
  },

  /** PM+ and DC can upload/create */
  canCreate(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** PM+ and DC can edit metadata or revise */
  canEdit(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /**
   * Delete is status-gated:
   *  - DC can delete only in deletable statuses (draft, under_review)
   *  - Admin+ can delete any status (must supply overrideReason in caller)
   */
  canDelete(role: string, docStatus: string): boolean {
    if (isAtLeast(role, "admin")) return true;
    if (role === "document_controller") {
      return DC_DELETABLE_STATUSES.includes(docStatus as any);
    }
    if (role === "project_manager") {
      return DC_DELETABLE_STATUSES.includes(docStatus as any);
    }
    return false;
  },

  /** Whether the delete requires an admin-override audit entry */
  deleteRequiresOverride(role: string, docStatus: string): boolean {
    return isAtLeast(role, "admin") && LOCKED_DOC_STATUSES.includes(docStatus as any);
  },

  /** PM+ and DC can submit a document into a workflow */
  canSubmitForWorkflow(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /**
   * Workflow-stage approvals are ASSIGNMENT-BASED, not role-based.
   * This returns whether the role is even eligible to be assigned as a reviewer.
   * The route must additionally verify the user is assigned to that specific stage.
   */
  isEligibleApprover(role: string): boolean {
    return isAtLeast(role, "reviewer");
  },

  /**
   * Admin-override approve/reject: bypasses workflow assignment.
   * Must be audit-logged with explicit reason.
   */
  canAdminOverrideApproval(role: string): boolean {
    return isAtLeast(role, "admin");
  },
} as const;

// ─── Correspondence Permissions ────────────────────────────────────────────

export const CorrespondencePermissions = {
  /**
   * All users see only correspondence where they are in To or CC (mail model).
   * PM and DC have an optional "view all project correspondence" capability
   * that is NOT on by default — the user must activate it.
   */
  canViewOwn(_role: string): boolean {
    return true;
  },

  /** Whether the role is eligible for the "view all project correspondence" capability */
  hasViewAllCapability(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** Reviewer, member and above can create correspondence */
  canCreate(role: string): boolean {
    return isAtLeast(role, "member");
  },

  /** Reviewer, member and above can reply */
  canReply(role: string): boolean {
    return isAtLeast(role, "member");
  },

  /** PM and DC can close or archive threads */
  canClose(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** Admin+ only can hard-delete correspondence */
  canDelete(role: string): boolean {
    return isAtLeast(role, "admin");
  },
} as const;

// ─── Transmittal Permissions ───────────────────────────────────────────────

export const TransmittalPermissions = {
  canView(_role: string): boolean {
    return true;
  },

  /** DC+ can create or edit drafts */
  canCreate(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** DC+ can send transmittals */
  canSend(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** Member+ can acknowledge receipt */
  canAcknowledge(role: string): boolean {
    return isAtLeast(role, "member");
  },

  /**
   * Setting review codes is ASSIGNMENT-BASED — the user must be an assigned reviewer.
   * This helper says whether the role is eligible at all.
   */
  isEligibleReviewer(role: string): boolean {
    return isAtLeast(role, "reviewer");
  },

  /**
   * Completing a review cycle is also ASSIGNMENT-BASED.
   * DC+ can complete; route must verify project ownership/assignment.
   */
  canCompleteReview(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** Admin+ can delete transmittals */
  canDelete(role: string): boolean {
    return isAtLeast(role, "admin");
  },
} as const;

// ─── Workflow Permissions ──────────────────────────────────────────────────

export const WorkflowPermissions = {
  /** Admin+ can configure workflow templates */
  canConfigureTemplates(role: string): boolean {
    return isAtLeast(role, "admin");
  },

  /** DC+ can trigger a workflow on a document */
  canTrigger(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /**
   * Advancing a workflow stage is ASSIGNMENT-BASED.
   * This says whether the role is eligible; route must verify assignment.
   */
  isEligibleToAdvanceStage(role: string): boolean {
    return isAtLeast(role, "reviewer");
  },

  /**
   * Admin-override: advance or skip a stage without being assigned.
   * Must be audit-logged with overrideReason.
   */
  canAdminOverrideAdvance(role: string): boolean {
    return isAtLeast(role, "admin");
  },
} as const;

// ─── Task Permissions ──────────────────────────────────────────────────────

/**
 * Task types:
 *  - "personal" — created by and for a single user; always owned by creator
 *  - "assigned"  — created within project/workflow/correspondence context; assigned to a user
 */
export type TaskType = "personal" | "assigned";

export const TaskPermissions = {
  /** All roles can view tasks assigned to them or personal tasks they own */
  canViewOwn(_role: string): boolean {
    return true;
  },

  /** DC+ can create project/workflow-assigned tasks */
  canCreateAssigned(role: string): boolean {
    return isAtLeast(role, "document_controller");
  },

  /** Any authenticated user can create personal tasks */
  canCreatePersonal(_role: string): boolean {
    return true;
  },

  /** PM+ can assign tasks to other users */
  canAssign(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },

  /** Member+ can mark their own assigned tasks complete; anyone can complete personal tasks */
  canCompleteOwn(_role: string): boolean {
    return true;
  },

  /** PM+ can delete assigned tasks in their project */
  canDelete(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },
} as const;

// ─── User & Project Management Permissions ─────────────────────────────────

export const ManagementPermissions = {
  /** Admin+ can invite users to the org */
  canInviteUsers(role: string): boolean {
    return isAtLeast(role, "admin");
  },

  /** Admin+ can set org-level roles */
  canSetOrgRoles(role: string): boolean {
    return isAtLeast(role, "admin");
  },

  /** PM+ can add users to a project */
  canAddProjectMembers(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },

  /** PM+ can set project-level roles */
  canSetProjectRoles(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },

  /**
   * Grant delegation: PM+ can delegate their own role or lower (project-scoped).
   * Admin+ can grant org-wide delegations.
   * Anti-escalation: grantedRole must be <= grantor's effective role.
   */
  canGrantDelegation(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },

  /** PM+ can view the audit log */
  canViewAuditLog(role: string): boolean {
    return isAtLeast(role, "project_manager");
  },
} as const;

// ─── Anti-escalation guard ─────────────────────────────────────────────────

/**
 * Ensures a delegation or role override cannot grant more than the grantor's
 * own effective role. Call this before inserting any delegation / override.
 *
 * @param grantorRole  Effective role of the user granting the delegation
 * @param targetRole   Role being granted
 * @returns true if the grant is safe; false if it would escalate privilege
 */
export function isNonEscalating(grantorRole: string, targetRole: string): boolean {
  return rankOf(targetRole) <= rankOf(grantorRole);
}

// ─── Assignment-based permission check helper ──────────────────────────────

/**
 * Marker type returned by routes to distinguish why an action was permitted:
 *  - "assigned"  — user is assigned to this specific stage/review
 *  - "admin_override" — admin bypassed assignment (must be audit-logged)
 */
export type PermissionBasis = "assigned" | "admin_override";

/**
 * Determines whether a user may perform an assignment-based action
 * (workflow approval, transmittal review, stage advance).
 *
 * @param role          Effective role of the caller
 * @param isAssigned    Whether the caller is assigned to this specific step
 * @returns null if denied, or the PermissionBasis if allowed
 */
export function checkAssignmentBasedPermission(
  role: string,
  isAssigned: boolean,
  minimumRoleForAssignment: AppRole = "reviewer",
): PermissionBasis | null {
  if (isAtLeast(role, "admin")) return "admin_override";
  if (isAssigned && isAtLeast(role, minimumRoleForAssignment)) return "assigned";
  return null;
}

// ─── Workflow stage permission check helper ────────────────────────────────

/**
 * True if `value` is one of the recognized AppRole keys.
 *
 * `wf_template_stages.responsible_role` must always be a valid AppRole so it
 * can be compared against a caller's effective role via isAtLeast(). Free-text
 * department labels (e.g. "Finance", "GM") are not valid here.
 */
export function isValidAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

/**
 * Marker type for why a workflow advance/reject was permitted:
 *  - "assigned_user"  — caller is wf_template_stages.responsibleUserId for the current stage
 *  - "assigned_role"  — caller's effective role >= wf_template_stages.responsibleRole
 *  - "admin_override" — admin/system_owner bypassed stage assignment (must be audit-logged)
 */
export type WorkflowStagePermissionBasis = "assigned_user" | "assigned_role" | "admin_override";

/**
 * Determines whether a user may advance/reject a workflow instance currently
 * sitting at `stage`.
 *
 * Order matters: a direct assignment match (user or role) is checked first so
 * that an admin who happens to also be the assigned approver is not logged as
 * an "override". Only when neither assignment matches does admin/system_owner
 * fall through as an override (which the caller must audit-log).
 *
 * A stage with neither responsibleUserId nor responsibleRole set (or a null
 * stage) can only be acted on via admin override.
 *
 * @returns null if denied, otherwise the basis for the permission grant
 */
export function checkWorkflowStagePermission(
  effectiveRole: string,
  userId: number,
  stage: { responsibleUserId: number | null; responsibleRole: string | null } | null | undefined,
): WorkflowStagePermissionBasis | null {
  if (stage?.responsibleUserId != null && stage.responsibleUserId === userId) {
    return "assigned_user";
  }
  if (stage?.responsibleRole && isAtLeast(effectiveRole, stage.responsibleRole as AppRole)) {
    return "assigned_role";
  }
  if (isAtLeast(effectiveRole, "admin")) return "admin_override";
  return null;
}
