/**
 * Document Status State Machine
 *
 * Defines which status transitions are allowed via the manual PUT endpoint,
 * and the minimum role required for each transition.
 *
 * Programmatic transitions driven by the workflow engine or transmittal
 * complete-review bypass this check (they use syncDocumentStatus /
 * applyDocumentReviewDecision directly) but are still audit-logged.
 */

export const ROLE_HIERARCHY: readonly string[] = [
  "viewer",
  "member",
  "reviewer",
  "document_controller",
  "project_manager",
  "admin",
  "system_owner",
];

function roleRank(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? -1 : idx;
}

function hasMinimumRole(callerRole: string, minimumRole: string): boolean {
  return roleRank(callerRole) >= roleRank(minimumRole);
}

/**
 * Allowed transitions for manual edits via PUT /documents/:id.
 * Map: fromStatus → { toStatus → minimumRole }
 */
const ALLOWED_TRANSITIONS: Record<string, Record<string, string>> = {
  draft: {
    under_review: "document_controller",
    issued:       "project_manager",
    archived:     "admin",
    void:         "admin",
  },
  under_review: {
    approved:               "document_controller",
    approved_with_comments: "document_controller",
    for_revision:           "document_controller",
    rejected:               "document_controller",
    draft:                  "project_manager",
    void:                   "admin",
  },
  approved: {
    issued:       "document_controller",
    for_revision: "project_manager",
    superseded:   "project_manager",
    archived:     "project_manager",
    void:         "admin",
  },
  approved_with_comments: {
    for_revision: "document_controller",
    issued:       "project_manager",
    archived:     "project_manager",
    void:         "admin",
  },
  for_revision: {
    draft:        "document_controller",
    under_review: "document_controller",
    void:         "admin",
  },
  rejected: {
    draft: "document_controller",
    void:  "admin",
  },
  issued: {
    superseded: "project_manager",
    archived:   "project_manager",
    void:       "admin",
  },
  superseded: {
    archived: "admin",
    void:     "admin",
  },
  archived: {
    void: "admin",
  },
  obsolete: {
    archived: "admin",
    void:     "admin",
  },
  void: {},
};

export interface TransitionError {
  code: "INVALID_TRANSITION" | "INSUFFICIENT_ROLE";
  message: string;
}

/**
 * Assert that a status transition is allowed for the given role.
 * Returns null on success, or a TransitionError describing the problem.
 */
export function checkStatusTransition(
  fromStatus: string,
  toStatus: string,
  callerRole: string,
): TransitionError | null {
  if (fromStatus === toStatus) return null;

  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed) {
    return {
      code: "INVALID_TRANSITION",
      message: `Documents in "${fromStatus}" status cannot be moved to any other status manually.`,
    };
  }

  const requiredRole = allowed[toStatus];
  if (requiredRole === undefined) {
    return {
      code: "INVALID_TRANSITION",
      message: `Cannot move a document from "${fromStatus}" to "${toStatus}". This transition is not permitted.`,
    };
  }

  if (!hasMinimumRole(callerRole, requiredRole)) {
    return {
      code: "INSUFFICIENT_ROLE",
      message: `Moving a document from "${fromStatus}" to "${toStatus}" requires at least the "${requiredRole}" role.`,
    };
  }

  return null;
}
