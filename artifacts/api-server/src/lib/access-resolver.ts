/**
 * AccessResolver — Phase C (shadow mode)
 *
 * Implements the full 9-rule visibility evaluation engine.
 * Shadow mode: NEVER blocks access, NEVER returns 403, NEVER modifies responses.
 * Only logs the comparison between the current system decision and the resolver's
 * computed decision so divergences are visible before enforcement is switched on.
 *
 * ─── Rule order ───────────────────────────────────────────────────────────────
 *
 *  0  system_owner_bypass    — system_owner: unconditional access
 *  1  explicit_deny          — deny rule for any of user's depts: DENY (beats all except R0)
 *  2  confidential_gate      — doc.is_confidential: user must be on allowlist or DENY
 *                              project_manager does NOT bypass this gate
 *  3  admin_bypass           — admin role (after deny + confidential checks): ALLOW
 *  4  project_member_gate    — not a member of the project: DENY
 *  5  project_manager_scope  — PM (global or project-level) with membership: ALLOW
 *  6  workflow_grant         — active transmittal recipient or current wf reviewer: ALLOW
 *  7  explicit_allow         — allow rule for any of user's depts: ALLOW
 *  8  dept_match             — user dept intersects doc dept assignments: ALLOW
 *  8a no_dept_restriction    — doc has no dept assignments: ALLOW (membership sufficient)
 *  9  implicit_deny          — no rule granted access: DENY
 *
 * ─── Architectural invariants ─────────────────────────────────────────────────
 *
 *  - Roles control actions; departments control visibility.
 *  - Workflow grants temporary visibility + action authority.
 *  - Confidential is allowlist-only; overrides roles and dept matching.
 *  - Explicit deny always wins (except system_owner).
 *  - Departments are org-internal only (cross-org FK already prevented upstream).
 *  - Integer IDs throughout (no UUIDs).
 */

import { db } from "@workspace/db";
import {
  userDepartmentsTable,
  documentDepartmentsTable,
  projectMembersTable,
  transmittalsTable,
  transmittalItemsTable,
  wfInstancesTable,
  wfTemplateStagesTable,
  documentAccessRulesTable,
  documentConfidentialAccessTable,
  accessShadowLogTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Sampling ─────────────────────────────────────────────────────────────────
// Divergences are always persisted to the DB.
// Non-diverging evaluations are sampled at this rate to keep the log table lean.
const SAMPLE_RATE = parseFloat(process.env["ACCESS_SHADOW_SAMPLE_RATE"] ?? "0.05");

// ─── Role constants ───────────────────────────────────────────────────────────
const SYSTEM_OWNER_ROLES  = new Set(["system_owner"]);
const ADMIN_ROLES         = new Set(["admin"]);
const PROJECT_MGR_ROLES   = new Set(["project_manager"]);
const TRANSMITTAL_ACTIVE  = ["sent", "acknowledged"] as const;

// ─── Public types ─────────────────────────────────────────────────────────────

export type AccessReason =
  | "system_owner_bypass"
  | "explicit_deny_rule"
  | "confidential_no_allowlist"
  | "admin_bypass"
  | "not_project_member"
  | "project_manager_scope"
  | "workflow_grant"
  | "explicit_allow_rule"
  | "dept_match"
  | "no_dept_restriction"
  | "dept_mismatch"
  | "implicit_deny";

export interface AccessDecision {
  allowed:  boolean;
  rulePath: string;
  reasons:  AccessReason[];
  summary:  string;
}

// ─── Context fed to the pure evaluator ───────────────────────────────────────

export interface ResolveContext {
  userId:               number;
  userRole:             string;            // global role from users.role
  projectMemberRole:    string | null;     // role from project_members.role (null = not a member)
  documentId:           number;
  projectId:            number | null;
  isConfidential:       boolean;           // documents.is_confidential
  userDepartmentIds:    number[];
  documentDepartmentIds: number[];
  // rows from document_access_rules for this document
  accessRules:          Array<{ departmentId: number; ruleType: string }>;
  // rows from document_confidential_access for this document (not expired)
  confidentialAllowlist: Array<{ userId: number | null; departmentId: number | null }>;
  hasWorkflowGrant:     boolean;           // active transmittal or wf reviewer
}

// ─── Pure evaluator ──────────────────────────────────────────────────────────

export function evaluateAccess(ctx: ResolveContext): AccessDecision {
  const userDeptSet = new Set(ctx.userDepartmentIds);

  // ── Rule 0: system_owner bypass ────────────────────────────────────────────
  if (SYSTEM_OWNER_ROLES.has(ctx.userRole)) {
    return {
      allowed:  true,
      rulePath: "system_owner_bypass",
      reasons:  ["system_owner_bypass"],
      summary:  "Platform system owner — unconditional access",
    };
  }

  // ── Rule 1: explicit deny ──────────────────────────────────────────────────
  // Any deny rule that matches one of the user's departments → DENY.
  // This beats admin, project_manager, dept_match, and allow rules.
  const hasDeny = ctx.accessRules
    .filter(r => r.ruleType === "deny")
    .some(r => userDeptSet.has(r.departmentId));

  if (hasDeny) {
    return {
      allowed:  false,
      rulePath: "explicit_deny",
      reasons:  ["explicit_deny_rule"],
      summary:  "Explicit deny rule matched one of the user's departments",
    };
  }

  // ── Rule 2: confidential gate ──────────────────────────────────────────────
  // If the document is marked confidential, the user must be on the allowlist.
  // project_manager, admin, org_owner — none of them bypass this gate.
  // Only system_owner (Rule 0) is exempt.
  if (ctx.isConfidential) {
    // Expiry is already filtered in buildContext; check user_id and dept_id match only.
    const onAllowlist = ctx.confidentialAllowlist.some(entry => {
      if (entry.userId === ctx.userId) return true;
      if (entry.departmentId !== null && userDeptSet.has(entry.departmentId)) return true;
      return false;
    });

    if (!onAllowlist) {
      return {
        allowed:  false,
        rulePath: "confidential_gate",
        reasons:  ["confidential_no_allowlist"],
        summary:  "Document is confidential; user is not on the confidential allowlist",
      };
    }
  }

  // ── Rule 3: admin bypass ───────────────────────────────────────────────────
  // Org admin after deny + confidential gates.
  if (ADMIN_ROLES.has(ctx.userRole)) {
    return {
      allowed:  true,
      rulePath: "admin_bypass",
      reasons:  ["admin_bypass"],
      summary:  "Org admin — access granted (after deny and confidential checks)",
    };
  }

  // ── Rule 4: project membership gate ───────────────────────────────────────
  const isProjectMember = ctx.projectMemberRole !== null;
  if (!isProjectMember) {
    return {
      allowed:  false,
      rulePath: "project_member_gate",
      reasons:  ["not_project_member"],
      summary:  "User is not a member of the document's project",
    };
  }

  // ── Rule 5: project_manager scope expansion ────────────────────────────────
  // A project_manager (global or project-level role) can see all docs in the
  // project after passing deny and confidential checks above.
  const effectiveRole = ctx.projectMemberRole ?? ctx.userRole;
  if (PROJECT_MGR_ROLES.has(effectiveRole) || PROJECT_MGR_ROLES.has(ctx.userRole)) {
    return {
      allowed:  true,
      rulePath: "project_manager_scope",
      reasons:  ["project_manager_scope"],
      summary:  "Project manager — expanded scope within project (deny + confidential already passed)",
    };
  }

  // ── Rule 6: workflow grant ─────────────────────────────────────────────────
  // Active transmittal recipient or current wf stage reviewer.
  if (ctx.hasWorkflowGrant) {
    return {
      allowed:  true,
      rulePath: "workflow_grant",
      reasons:  ["workflow_grant"],
      summary:  "User has an active workflow or transmittal grant for this document",
    };
  }

  // ── Rule 7: explicit allow ─────────────────────────────────────────────────
  const hasAllow = ctx.accessRules
    .filter(r => r.ruleType === "allow")
    .some(r => userDeptSet.has(r.departmentId));

  if (hasAllow) {
    return {
      allowed:  true,
      rulePath: "explicit_allow",
      reasons:  ["explicit_allow_rule"],
      summary:  "Explicit allow rule matched one of the user's departments",
    };
  }

  // ── Rule 8a: no department restrictions ───────────────────────────────────
  if (ctx.documentDepartmentIds.length === 0) {
    return {
      allowed:  true,
      rulePath: "no_dept_restriction",
      reasons:  ["no_dept_restriction"],
      summary:  "Document has no department restrictions; project membership is sufficient",
    };
  }

  // ── Rule 8: department match ───────────────────────────────────────────────
  const hasMatch = ctx.documentDepartmentIds.some(d => userDeptSet.has(d));
  if (hasMatch) {
    return {
      allowed:  true,
      rulePath: "dept_match",
      reasons:  ["dept_match"],
      summary:  "User's department matches a document department restriction",
    };
  }

  // ── Rule 9: implicit deny ──────────────────────────────────────────────────
  return {
    allowed:  false,
    rulePath: "implicit_deny",
    reasons:  ["dept_mismatch", "implicit_deny"],
    summary:  "User belongs to none of the document's required departments",
  };
}

// ─── DB persistence ──────────────────────────────────────────────────────────

async function persistToLog(
  ctx: ResolveContext,
  decision: AccessDecision,
  systemAllowed: boolean,
): Promise<void> {
  const diverges = decision.allowed !== systemAllowed;
  if (!diverges && Math.random() > SAMPLE_RATE) return;  // sample agreements

  await db.insert(accessShadowLogTable).values({
    documentId:      ctx.documentId,
    userId:          ctx.userId,
    userRole:        ctx.userRole,
    projectId:       ctx.projectId,
    systemAllowed,
    resolverAllowed: decision.allowed,
    resolverReasons: decision.reasons,
    rulePath:        decision.rulePath,
    diverges,
    userDeptIds:     ctx.userDepartmentIds,
    docDeptIds:      ctx.documentDepartmentIds,
    hasConfidential: ctx.isConfidential,
    hasDenyRule:     ctx.accessRules.some(r => r.ruleType === "deny"),
    hasWorkflowGrant: ctx.hasWorkflowGrant,
  });
}

// ─── Single-document context builder ─────────────────────────────────────────

interface ShadowInput {
  userId:     number;
  userRole:   string;
  documentId: number;
  projectId:  number | null;
  /** is_confidential from the document row, if already fetched */
  isConfidential?: boolean;
}

async function buildContext(input: ShadowInput): Promise<ResolveContext> {
  const pid = input.projectId;

  const [
    userDepts,
    docDepts,
    memberRow,
    accessRules,
    rawConfAllowlist,
    workflowGrant,
  ] = await Promise.all([
    // User's department memberships
    db.select({ departmentId: userDepartmentsTable.departmentId })
      .from(userDepartmentsTable)
      .where(eq(userDepartmentsTable.userId, input.userId)),

    // Document's department assignments
    db.select({ departmentId: documentDepartmentsTable.departmentId })
      .from(documentDepartmentsTable)
      .where(eq(documentDepartmentsTable.documentId, input.documentId)),

    // Project membership row — includes project-level role
    pid
      ? db.select({ role: projectMembersTable.role })
          .from(projectMembersTable)
          .where(and(
            eq(projectMembersTable.projectId, pid),
            eq(projectMembersTable.userId, input.userId),
          ))
          .limit(1)
      : Promise.resolve([] as { role: string }[]),

    // Explicit access rules (allow/deny) for this document
    db.select({
        departmentId: documentAccessRulesTable.departmentId,
        ruleType:     documentAccessRulesTable.ruleType,
      })
      .from(documentAccessRulesTable)
      .where(eq(documentAccessRulesTable.documentId, input.documentId)),

    // Confidential allowlist for this document (expiry filtered in-memory below)
    db.select({
        userId:       documentConfidentialAccessTable.userId,
        departmentId: documentConfidentialAccessTable.departmentId,
        expiresAt:    documentConfidentialAccessTable.expiresAt,
      })
      .from(documentConfidentialAccessTable)
      .where(eq(documentConfidentialAccessTable.documentId, input.documentId)),

    // Workflow grant: transmittal recipient OR active wf stage reviewer
    buildWorkflowGrant(input.userId, input.documentId),
  ]);

  const now = new Date();
  const confidentialAllowlist = rawConfAllowlist
    .filter(e => !e.expiresAt || new Date(e.expiresAt as any) > now)
    .map(e => ({ userId: e.userId, departmentId: e.departmentId }));

  return {
    userId:                input.userId,
    userRole:              input.userRole,
    projectMemberRole:     memberRow[0]?.role ?? null,
    documentId:            input.documentId,
    projectId:             input.projectId,
    isConfidential:        input.isConfidential ?? false,
    userDepartmentIds:     userDepts.map(r => r.departmentId),
    documentDepartmentIds: docDepts.map(r => r.departmentId),
    accessRules,
    confidentialAllowlist,
    hasWorkflowGrant:      workflowGrant,
  };
}

async function buildWorkflowGrant(userId: number, documentId: number): Promise<boolean> {
  // Check 1: user is the toUserId of a non-draft, non-rejected transmittal
  // that contains this document
  const [txRow] = await db
    .select({ id: transmittalsTable.id })
    .from(transmittalItemsTable)
    .innerJoin(transmittalsTable, eq(transmittalItemsTable.transmittalId, transmittalsTable.id))
    .where(and(
      eq(transmittalItemsTable.documentId, documentId),
      eq(transmittalsTable.toUserId, userId),
      inArray(transmittalsTable.status, [...TRANSMITTAL_ACTIVE]),
    ))
    .limit(1);

  if (txRow) return true;

  // Check 2: user is the responsibleUserId on the document's current active wf stage
  const [wfRow] = await db
    .select({ id: wfInstancesTable.id })
    .from(wfInstancesTable)
    .innerJoin(
      wfTemplateStagesTable,
      eq(wfInstancesTable.currentStageId, wfTemplateStagesTable.id),
    )
    .where(and(
      eq(wfInstancesTable.documentId, documentId),
      eq(wfInstancesTable.status, "active"),
      eq(wfTemplateStagesTable.responsibleUserId, userId),
    ))
    .limit(1);

  return !!wfRow;
}

// ─── Public API — single document (fire-and-forget) ──────────────────────────

/**
 * Evaluate access in shadow mode for a single document alongside a live request.
 *
 * Call this AFTER the current system has produced its decision.
 * Guarantees:
 *   - Never throws (errors are caught and logged)
 *   - Never modifies the caller's response
 *   - Safe to fire-and-forget: void shadowEvaluate(...)
 */
export async function shadowEvaluate(
  input: ShadowInput,
  systemAllowed: boolean,
): Promise<void> {
  try {
    const ctx      = await buildContext(input);
    const decision = evaluateAccess(ctx);
    const diverges = decision.allowed !== systemAllowed;

    const logPayload = {
      phase:      "shadow_access_resolver_v2",
      documentId: input.documentId,
      userId:     input.userId,
      userRole:   input.userRole,
      projectId:  input.projectId,
      system:   { allowed: systemAllowed },
      resolver: {
        allowed:  decision.allowed,
        rulePath: decision.rulePath,
        reasons:  decision.reasons,
        summary:  decision.summary,
      },
      context: {
        userDeptIds:      ctx.userDepartmentIds,
        docDeptIds:       ctx.documentDepartmentIds,
        isConfidential:   ctx.isConfidential,
        hasDenyRule:      ctx.accessRules.some(r => r.ruleType === "deny"),
        hasWorkflowGrant: ctx.hasWorkflowGrant,
        isProjectMember:  ctx.projectMemberRole !== null,
        projectMemberRole: ctx.projectMemberRole,
      },
      diverges,
    };

    if (diverges) {
      logger.warn(logPayload, "[shadow-resolver] DIVERGENCE — system and resolver disagree");
    } else {
      logger.info(logPayload, "[shadow-resolver] access evaluation (agreement)");
    }

    await persistToLog(ctx, decision, systemAllowed);
  } catch (err) {
    logger.warn(
      { err, documentId: input.documentId, userId: input.userId },
      "[shadow-resolver] evaluation error (suppressed)",
    );
  }
}

// ─── Public API — list (batched, fire-and-forget) ────────────────────────────

interface ListDoc {
  id:             number;
  projectId:      number | null;
  isConfidential: boolean | null;
}

/**
 * Batch shadow evaluation for list endpoints.
 *
 * Uses 7 batch queries regardless of list size (no N×7 problem).
 * Logs a per-request summary, persists individual divergences, samples agreements.
 */
export async function shadowEvaluateList(opts: {
  userId:    number;
  userRole:  string;
  documents: ListDoc[];
  endpoint:  string;
}): Promise<void> {
  if (!opts.documents.length) return;

  try {
    const { userId, userRole, documents } = opts;
    const docIds = documents.map(d => d.id);
    const projectIds = [...new Set(documents.map(d => d.projectId).filter((p): p is number => p !== null))];

    // ── Batch DB fetches ───────────────────────────────────────────────────

    const [
      userDepts,
      projectMemberships,
      allDocDepts,
      allAccessRules,
      allConfAllowlist,
    ] = await Promise.all([
      // User's department memberships (same for all docs)
      db.select({ departmentId: userDepartmentsTable.departmentId })
        .from(userDepartmentsTable)
        .where(eq(userDepartmentsTable.userId, userId)),

      // User's project-specific roles for all relevant projects
      projectIds.length
        ? db.select({
              projectId: projectMembersTable.projectId,
              role:      projectMembersTable.role,
            })
            .from(projectMembersTable)
            .where(and(
              eq(projectMembersTable.userId, userId),
              inArray(projectMembersTable.projectId, projectIds),
            ))
        : Promise.resolve([] as { projectId: number; role: string }[]),

      // Department assignments for all docs
      db.select({
            documentId:   documentDepartmentsTable.documentId,
            departmentId: documentDepartmentsTable.departmentId,
          })
        .from(documentDepartmentsTable)
        .where(inArray(documentDepartmentsTable.documentId, docIds)),

      // Access rules for all docs
      db.select({
            documentId:   documentAccessRulesTable.documentId,
            departmentId: documentAccessRulesTable.departmentId,
            ruleType:     documentAccessRulesTable.ruleType,
          })
        .from(documentAccessRulesTable)
        .where(inArray(documentAccessRulesTable.documentId, docIds)),

      // Confidential allowlist for all docs
      db.select({
            documentId:   documentConfidentialAccessTable.documentId,
            userId:       documentConfidentialAccessTable.userId,
            departmentId: documentConfidentialAccessTable.departmentId,
            expiresAt:    documentConfidentialAccessTable.expiresAt,
          })
        .from(documentConfidentialAccessTable)
        .where(inArray(documentConfidentialAccessTable.documentId, docIds)),
    ]);

    // Batch workflow grants — two queries covering all docs
    const [txGrants, wfGrants] = await Promise.all([
      db.select({ documentId: transmittalItemsTable.documentId })
        .from(transmittalItemsTable)
        .innerJoin(transmittalsTable, eq(transmittalItemsTable.transmittalId, transmittalsTable.id))
        .where(and(
          inArray(transmittalItemsTable.documentId, docIds),
          eq(transmittalsTable.toUserId, userId),
          inArray(transmittalsTable.status, [...TRANSMITTAL_ACTIVE]),
        )),

      db.select({ documentId: wfInstancesTable.documentId })
        .from(wfInstancesTable)
        .innerJoin(
          wfTemplateStagesTable,
          eq(wfInstancesTable.currentStageId, wfTemplateStagesTable.id),
        )
        .where(and(
          inArray(wfInstancesTable.documentId, docIds),
          eq(wfInstancesTable.status, "active"),
          eq(wfTemplateStagesTable.responsibleUserId, userId),
        )),
    ]);

    // ── Build lookup maps ─────────────────────────────────────────────────

    const userDeptIds = userDepts.map(r => r.departmentId);
    const memberRoleByProject = new Map(projectMemberships.map(r => [r.projectId, r.role]));

    const docDeptsMap   = new Map<number, number[]>();
    const accessRuleMap = new Map<number, Array<{ departmentId: number; ruleType: string }>>();
    const confMap       = new Map<number, Array<{ userId: number | null; departmentId: number | null }>>();
    const wfGrantSet    = new Set<number>();

    for (const r of allDocDepts) {
      if (!docDeptsMap.has(r.documentId)) docDeptsMap.set(r.documentId, []);
      docDeptsMap.get(r.documentId)!.push(r.departmentId);
    }
    for (const r of allAccessRules) {
      if (!accessRuleMap.has(r.documentId)) accessRuleMap.set(r.documentId, []);
      accessRuleMap.get(r.documentId)!.push({ departmentId: r.departmentId, ruleType: r.ruleType });
    }
    const now = new Date();
    for (const r of allConfAllowlist) {
      if (r.expiresAt && new Date(r.expiresAt as any) <= now) continue;
      if (!confMap.has(r.documentId)) confMap.set(r.documentId, []);
      confMap.get(r.documentId)!.push({ userId: r.userId, departmentId: r.departmentId });
    }
    for (const r of txGrants)  wfGrantSet.add(r.documentId!);
    for (const r of wfGrants)  wfGrantSet.add(r.documentId!);

    // ── Evaluate each document ────────────────────────────────────────────

    let resolverAllowCount = 0;
    let resolverDenyCount  = 0;
    const divergeDocIds: number[] = [];
    const toInsert: typeof accessShadowLogTable.$inferInsert[] = [];

    for (const doc of documents) {
      const ctx: ResolveContext = {
        userId,
        userRole,
        projectMemberRole:     doc.projectId ? (memberRoleByProject.get(doc.projectId) ?? null) : null,
        documentId:            doc.id,
        projectId:             doc.projectId,
        isConfidential:        doc.isConfidential ?? false,
        userDepartmentIds:     userDeptIds,
        documentDepartmentIds: docDeptsMap.get(doc.id) ?? [],
        accessRules:           accessRuleMap.get(doc.id) ?? [],
        confidentialAllowlist: confMap.get(doc.id) ?? [],
        hasWorkflowGrant:      wfGrantSet.has(doc.id),
      };

      const decision = evaluateAccess(ctx);
      if (decision.allowed) resolverAllowCount++; else resolverDenyCount++;

      // System always allowed everything in the list response
      const systemAllowed = true;
      const diverges = !decision.allowed;  // resolver would deny something system shows

      if (diverges) divergeDocIds.push(doc.id);

      if (diverges || Math.random() <= SAMPLE_RATE) {
        toInsert.push({
          documentId:      doc.id,
          userId,
          userRole,
          projectId:       doc.projectId,
          systemAllowed,
          resolverAllowed: decision.allowed,
          resolverReasons: decision.reasons,
          rulePath:        decision.rulePath,
          diverges,
          userDeptIds:     userDeptIds,
          docDeptIds:      ctx.documentDepartmentIds,
          hasConfidential: ctx.isConfidential,
          hasDenyRule:     ctx.accessRules.some(r => r.ruleType === "deny"),
          hasWorkflowGrant: ctx.hasWorkflowGrant,
        });
      }
    }

    // ── Batch persist ─────────────────────────────────────────────────────
    if (toInsert.length) {
      await db.insert(accessShadowLogTable).values(toInsert);
    }

    // ── Summary log ───────────────────────────────────────────────────────
    const logLevel = divergeDocIds.length > 0 ? "warn" : "info";
    logger[logLevel]({
      phase:              "shadow_access_resolver_v2_list",
      endpoint:           opts.endpoint,
      userId,
      userRole,
      totalDocs:          documents.length,
      resolverAllowCount,
      resolverDenyCount,
      divergeCount:       divergeDocIds.length,
      divergeDocIds,
    }, divergeDocIds.length > 0
      ? "[shadow-resolver] LIST — divergences found"
      : "[shadow-resolver] LIST — all in agreement",
    );
  } catch (err) {
    logger.warn(
      { err, userId: opts.userId, endpoint: opts.endpoint },
      "[shadow-resolver] list evaluation error (suppressed)",
    );
  }
}
