/**
 * AccessResolver — Phase C preparation (shadow mode only)
 *
 * Evaluates document visibility using:
 *   - project membership      (current system baseline)
 *   - user's department memberships
 *   - document's department assignments
 *
 * Shadow mode: NEVER blocks access, NEVER returns 403.
 * Only logs the comparison between the current system decision
 * and the resolver's computed decision so divergences are visible
 * before enforcement is switched on.
 *
 * Architecture is designed to later add:
 *   - confidential document rules
 *   - transmittal-based access grants
 *   - explicit per-department allow / deny rules
 */

import { db } from "@workspace/db";
import {
  userDepartmentsTable,
  documentDepartmentsTable,
  projectDepartmentsTable,
  projectMembersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Machine-readable reason codes for an access decision. */
export type AccessReason =
  | "admin_bypass"               // sys_owner / admin — always allowed
  | "not_project_member"         // user not in project_members for this project
  | "no_dept_restriction"        // document has no dept assignments → project membership suffices
  | "dept_match"                 // user is in ≥1 dept that the document requires
  | "dept_mismatch";             // document requires a dept the user doesn't belong to

/** The outcome of a single access evaluation. */
export interface AccessDecision {
  allowed: boolean;
  reasons: AccessReason[];
  summary: string;
}

/** Raw inputs the resolver needs (pre-fetched or injected). */
export interface ResolveInput {
  userId: number;
  userRole: string;
  documentId: number;
  projectId: number | null;
  userDepartmentIds: number[];
  documentDepartmentIds: number[];
  isProjectMember: boolean;
}

/** Full context including data that callers may not yet have. */
interface ResolveContext extends ResolveInput {
  projectDepartmentIds: number[];   // reserved for future rules
}

// ─── Pure resolver ────────────────────────────────────────────────────────────

const ADMIN_ROLES: ReadonlySet<string> = new Set(["system_owner", "admin"]);

/**
 * Pure function — takes pre-fetched context, returns a decision.
 * No DB calls, no side effects.
 *
 * Future rule additions (confidential, transmittals, explicit deny)
 * should be implemented as additional if-blocks here, in priority order.
 * Return early from each rule to short-circuit.
 */
export function evaluateAccess(input: ResolveInput): AccessDecision {
  // ── Rule 0: admin bypass ─────────────────────────────────────────────────
  if (ADMIN_ROLES.has(input.userRole)) {
    return {
      allowed: true,
      reasons: ["admin_bypass"],
      summary: "System admin — unconditional access",
    };
  }

  // ── Rule 1: project membership gate ──────────────────────────────────────
  if (!input.isProjectMember) {
    return {
      allowed: false,
      reasons: ["not_project_member"],
      summary: "User is not a member of the document's project",
    };
  }

  // ── Rule 2: no department restrictions on document ────────────────────────
  if (input.documentDepartmentIds.length === 0) {
    return {
      allowed: true,
      reasons: ["no_dept_restriction"],
      summary: "Project member; document has no department restrictions",
    };
  }

  // ── Rule 3: department-level restriction ──────────────────────────────────
  const userDeptSet = new Set(input.userDepartmentIds);
  const hasMatch = input.documentDepartmentIds.some(d => userDeptSet.has(d));

  if (hasMatch) {
    return {
      allowed: true,
      reasons: ["dept_match"],
      summary: "User's department matches a document department restriction",
    };
  }

  return {
    allowed: false,
    reasons: ["dept_mismatch"],
    summary: "User belongs to none of the document's required departments",
  };
}

// ─── Data fetcher ─────────────────────────────────────────────────────────────

interface ShadowInput {
  userId: number;
  userRole: string;
  documentId: number;
  projectId: number | null;
}

async function buildContext(input: ShadowInput): Promise<ResolveContext> {
  const [userDepts, docDepts, projDepts, membership] = await Promise.all([
    // User's department memberships
    db
      .select({ departmentId: userDepartmentsTable.departmentId })
      .from(userDepartmentsTable)
      .where(eq(userDepartmentsTable.userId, input.userId)),

    // Document's department assignments
    db
      .select({ departmentId: documentDepartmentsTable.departmentId })
      .from(documentDepartmentsTable)
      .where(eq(documentDepartmentsTable.documentId, input.documentId)),

    // Project's department assignments (reserved for future rules)
    input.projectId
      ? db
          .select({ departmentId: projectDepartmentsTable.departmentId })
          .from(projectDepartmentsTable)
          .where(eq(projectDepartmentsTable.projectId, input.projectId))
      : Promise.resolve([] as { departmentId: number }[]),

    // Project membership
    input.projectId
      ? db
          .select({ id: projectMembersTable.id })
          .from(projectMembersTable)
          .where(
            and(
              eq(projectMembersTable.projectId, input.projectId),
              eq(projectMembersTable.userId, input.userId),
            ),
          )
          .limit(1)
      : Promise.resolve([] as { id: number }[]),
  ]);

  return {
    ...input,
    userDepartmentIds:     userDepts.map(r => r.departmentId),
    documentDepartmentIds: docDepts.map(r => r.departmentId),
    projectDepartmentIds:  projDepts.map(r => r.departmentId),
    isProjectMember:       membership.length > 0,
  };
}

// ─── Shadow evaluation (public API) ──────────────────────────────────────────

/**
 * Run the access resolver in shadow mode alongside a live request.
 *
 * Call this AFTER the current system has already produced its decision.
 * The resolver evaluates independently and logs any divergence.
 *
 * Guarantees:
 *   - Never throws (errors are caught and logged separately)
 *   - Never modifies the caller's response
 *   - Never calls res.status() or next()
 *   - Safe to fire-and-forget (returns void)
 *
 * @param input          Identifiers for the request context
 * @param systemAllowed  What the current system decided (true = allowed)
 */
export async function shadowEvaluate(
  input: ShadowInput,
  systemAllowed: boolean,
): Promise<void> {
  try {
    const context = await buildContext(input);
    const decision = evaluateAccess(context);
    const diverges = decision.allowed !== systemAllowed;

    const logPayload = {
      phase:      "shadow_access_resolver",
      documentId: input.documentId,
      userId:     input.userId,
      userRole:   input.userRole,
      projectId:  input.projectId,
      system:   { allowed: systemAllowed },
      resolver: {
        allowed:  decision.allowed,
        reasons:  decision.reasons,
        summary:  decision.summary,
      },
      context: {
        userDepartmentIds:     context.userDepartmentIds,
        documentDepartmentIds: context.documentDepartmentIds,
        projectDepartmentIds:  context.projectDepartmentIds,
        isProjectMember:       context.isProjectMember,
      },
      diverges,
    };

    if (diverges) {
      logger.warn(logPayload, "[shadow-resolver] DIVERGENCE — system and resolver disagree");
    } else {
      logger.info(logPayload, "[shadow-resolver] access evaluation (agreement)");
    }
  } catch (err) {
    // Shadow mode must never surface errors to callers
    logger.warn(
      { err, documentId: input.documentId, userId: input.userId },
      "[shadow-resolver] evaluation error (suppressed)",
    );
  }
}
