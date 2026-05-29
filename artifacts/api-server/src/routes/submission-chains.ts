/**
 * Submission Chain API — Phase 2
 *
 * Routes mounted at /api/projects/:projectId/submission-chains
 *
 * Permission model:
 *  CREATE chain           → PM+ (project-effective role)
 *  READ chain / list      → any project member whose org is in allowed_parties, OR PM+
 *  PATCH (edit metadata)  → PM+, chain must be draft
 *  DELETE                 → admin+, chain must be draft
 *  Manage allowed parties → PM+, chain must be draft
 *  Add / remove documents → PM+ or DC of originating org, chain must be draft
 *  ACTIVATE (draft→active)→ PM+ or DC, caller org must be originatingOrgId
 *  FORWARD                → PM+ or DC, caller org must be currentOrgId
 *  RETURN                 → PM+ or DC, caller org must be currentOrgId
 *  RESUBMIT (after return)→ PM+ or DC, caller org must be originatingOrgId
 *  CLOSE (manual)         → PM+
 *
 * Chain number format: SC-{PROJECT_CODE}-{YYYY}-{SEQ 4-digit}
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  submissionChainsTable,
  submissionChainAllowedPartiesTable,
  submissionChainStepsTable,
  submissionChainDocumentsTable,
  documentsTable,
  documentRevisionsTable,
  organizationsTable,
  projectsTable,
  projectMembersTable,
  usersTable,
} from "@workspace/db";
import {
  eq, and, desc, asc, sql, inArray,
} from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { resolveEffectiveRole } from "../lib/governance.js";
import { isAtLeast } from "../lib/permissions.js";
import { createAuditLog } from "../lib/audit.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { sendEmail } from "../lib/email.js";
import {param, paramInt, requireInt, type ProjectParams, type ProjectItemParams} from '../lib/params';
import type { Request } from 'express';

const router = Router({ mergeParams: true });
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the caller's effective role for this project. */
async function effectiveRole(req: any, projectId: number): Promise<string> {
  const resolved = await resolveEffectiveRole(req.user, projectId);
  return resolved.role;
}

/** Fetch a chain and verify it belongs to the correct project. */
async function loadChain(id: number, projectId: number) {
  const [chain] = await db
    .select()
    .from(submissionChainsTable)
    .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));
  return chain ?? null;
}

/**
 * Verify the caller's org is in allowed_parties for this chain.
 * System owners (no org) always pass.
 */
async function callerIsAllowedParty(chainId: number, orgId: number | null | undefined): Promise<boolean> {
  if (!orgId) return true; // system_owner
  const [row] = await db
    .select({ id: submissionChainAllowedPartiesTable.id })
    .from(submissionChainAllowedPartiesTable)
    .where(
      and(
        eq(submissionChainAllowedPartiesTable.chainId, chainId),
        eq(submissionChainAllowedPartiesTable.orgId, orgId),
      ),
    )
    .limit(1);
  return !!row;
}

/** Generate the next chain number for a project, e.g. SC-PROJ-2025-0001 */
async function generateChainNumber(projectId: number): Promise<string> {
  const [project] = await db
    .select({ code: projectsTable.code })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  const code = project?.code ?? "PRJ";
  const year = new Date().getFullYear();

  const existing = await db
    .select({ id: submissionChainsTable.id })
    .from(submissionChainsTable)
    .where(eq(submissionChainsTable.projectId, projectId));

  const seq = String(existing.length + 1).padStart(4, "0");
  return `SC-${code}-${year}-${seq}`;
}

/** Load ordered allowed parties with org names and default assignee. */
async function loadAllowedParties(chainId: number) {
  return db
    .select({
      id:                   submissionChainAllowedPartiesTable.id,
      orgId:                submissionChainAllowedPartiesTable.orgId,
      stepOrder:            submissionChainAllowedPartiesTable.stepOrder,
      label:                submissionChainAllowedPartiesTable.label,
      defaultAssigneeId:    submissionChainAllowedPartiesTable.defaultAssigneeId,
      orgName:              organizationsTable.name,
      defaultAssigneeName:  sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainAllowedPartiesTable.defaultAssigneeId}
      )`,
    })
    .from(submissionChainAllowedPartiesTable)
    .leftJoin(organizationsTable, eq(submissionChainAllowedPartiesTable.orgId, organizationsTable.id))
    .where(eq(submissionChainAllowedPartiesTable.chainId, chainId))
    .orderBy(asc(submissionChainAllowedPartiesTable.stepOrder));
}

/**
 * Validate that a user belongs to a given org AND has project access.
 * Returns the user row on success, null on failure.
 */
async function validateAssignee(userId: number, orgId: number, projectId: number) {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, organizationId: usersTable.organizationId,
              firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.organizationId, orgId)))
    .limit(1);
  if (!user) return null;

  // Verify project membership
  const [member] = await db
    .select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.userId, userId),
      eq(projectMembersTable.projectId, projectId),
    ))
    .limit(1);

  return member ? user : null;
}

/**
 * Build notification recipients for a step's assigned user.
 * If assignedUserId is set, returns just that user.
 * Otherwise falls back to DC+ members of the org who have project access.
 */
async function stepNotificationRecipients(
  assignedUserId: number | null | undefined,
  toOrgId: number,
  projectId: number,
) {
  if (assignedUserId) {
    const [u] = await db
      .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, assignedUserId))
      .limit(1);
    if (u) return [{ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}` }];
  }

  // Fallback: DC+ users in the org with project access
  const members = await db
    .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, role: projectMembersTable.role })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(usersTable.organizationId, toOrgId),
    ));

  return members
    .filter(m => isAtLeast(m.role, "document_controller"))
    .map(m => ({ userId: m.id, email: m.email, name: `${m.firstName} ${m.lastName}` }));
}

/** Load chain documents for a given revision cycle (or all cycles). */
async function loadChainDocuments(chainId: number, cycle?: number) {
  const conditions = cycle !== undefined
    ? and(
        eq(submissionChainDocumentsTable.chainId, chainId),
        eq(submissionChainDocumentsTable.revisionCycle, cycle),
      )
    : eq(submissionChainDocumentsTable.chainId, chainId);

  return db
    .select({
      id:             submissionChainDocumentsTable.id,
      documentId:     submissionChainDocumentsTable.documentId,
      revisionId:     submissionChainDocumentsTable.revisionId,
      revisionCycle:  submissionChainDocumentsTable.revisionCycle,
      addedAt:        submissionChainDocumentsTable.addedAt,
      documentNumber: documentsTable.documentNumber,
      documentTitle:  documentsTable.title,
      documentType:   documentsTable.documentType,
      discipline:     documentsTable.discipline,
      revision:       documentRevisionsTable.revision,
      revisionStatus: documentRevisionsTable.status,
      fileName:       documentRevisionsTable.fileName,
    })
    .from(submissionChainDocumentsTable)
    .leftJoin(documentsTable, eq(submissionChainDocumentsTable.documentId, documentsTable.id))
    .leftJoin(documentRevisionsTable, eq(submissionChainDocumentsTable.revisionId, documentRevisionsTable.id))
    .where(conditions!)
    .orderBy(asc(submissionChainDocumentsTable.addedAt));
}

/** Load all steps for a chain, including user-level assignment fields. */
async function loadSteps(chainId: number) {
  return db
    .select({
      id:               submissionChainStepsTable.id,
      chainId:          submissionChainStepsTable.chainId,
      stepNumber:       submissionChainStepsTable.stepNumber,
      revisionCycle:    submissionChainStepsTable.revisionCycle,
      action:           submissionChainStepsTable.action,
      fromOrgId:        submissionChainStepsTable.fromOrgId,
      toOrgId:          submissionChainStepsTable.toOrgId,
      stepStatus:       submissionChainStepsTable.stepStatus,
      reviewCode:       submissionChainStepsTable.reviewCode,
      comments:         submissionChainStepsTable.comments,
      reviewedAt:       submissionChainStepsTable.reviewedAt,
      transmittalId:    submissionChainStepsTable.transmittalId,
      assignedToUserId: submissionChainStepsTable.assignedToUserId,
      reassignedAt:     submissionChainStepsTable.reassignedAt,
      reassignedById:   submissionChainStepsTable.reassignedById,
      createdAt:        submissionChainStepsTable.createdAt,
      fromOrgName:      sql<string>`(SELECT name FROM organizations WHERE id = ${submissionChainStepsTable.fromOrgId})`,
      toOrgName:        sql<string>`(SELECT name FROM organizations WHERE id = ${submissionChainStepsTable.toOrgId})`,
      actionedByName:   sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainStepsTable.actionedById}
      )`,
      reviewedByName:   sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainStepsTable.reviewedById}
      )`,
      assignedToUserName: sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainStepsTable.assignedToUserId}
      )`,
      reassignedByName: sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainStepsTable.reassignedById}
      )`,
    })
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, chainId))
    .orderBy(asc(submissionChainStepsTable.stepNumber));
}

// ─── Shared chain summary select ──────────────────────────────────────────────

function chainSummarySelect() {
  return db
    .select({
      id:                   submissionChainsTable.id,
      chainNumber:          submissionChainsTable.chainNumber,
      title:                submissionChainsTable.title,
      description:          submissionChainsTable.description,
      projectId:            submissionChainsTable.projectId,
      originatingOrgId:     submissionChainsTable.originatingOrgId,
      currentOrgId:         submissionChainsTable.currentOrgId,
      currentStatus:        submissionChainsTable.currentStatus,
      activeRevisionCycle:  submissionChainsTable.activeRevisionCycle,
      currentStepStartedAt: submissionChainsTable.currentStepStartedAt,
      autoClosedAt:         submissionChainsTable.autoClosedAt,
      createdAt:            submissionChainsTable.createdAt,
      updatedAt:            submissionChainsTable.updatedAt,
      originatingOrgName:   sql<string>`(SELECT name FROM organizations WHERE id = ${submissionChainsTable.originatingOrgId})`,
      currentOrgName:       sql<string>`(SELECT name FROM organizations WHERE id = ${submissionChainsTable.currentOrgId})`,
      createdByName:        sql<string | null>`(
        SELECT first_name || ' ' || last_name
        FROM users WHERE id = ${submissionChainsTable.createdById}
      )`,
      documentCount: sql<number>`(
        SELECT COUNT(*)::int FROM submission_chain_documents
        WHERE chain_id = "submission_chains"."id"
          AND revision_cycle = "submission_chains"."active_revision_cycle"
      )`,
      stepCount: sql<number>`(
        SELECT COUNT(*)::int FROM submission_chain_steps
        WHERE chain_id = "submission_chains"."id"
      )`,
      // Current step's assigned user (most recent step)
      currentAssignedUserId: sql<number | null>`(
        SELECT assigned_to_user_id FROM submission_chain_steps
        WHERE chain_id = "submission_chains"."id"
        ORDER BY step_number DESC LIMIT 1
      )`,
      currentAssignedUserName: sql<string | null>`(
        SELECT u.first_name || ' ' || u.last_name
        FROM submission_chain_steps s
        JOIN users u ON u.id = s.assigned_to_user_id
        WHERE s.chain_id = "submission_chains"."id"
        ORDER BY s.step_number DESC LIMIT 1
      )`,
    })
    .from(submissionChainsTable);
}

// ─── GET / — list chains for project ─────────────────────────────────────────

router.get("/", async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const { status, orgId: orgFilter } = req.query;
  const userOrgId = req.user!.organizationId;
  const role = await effectiveRole(req, projectId);

  // Build a list of chain IDs the caller is allowed to see (allowed-party check)
  // PM+ can see all chains; anyone else only sees chains where their org is listed.
  let visibleChainIds: number[] | null = null;
  if (!isAtLeast(role, "project_manager")) {
    if (!userOrgId) { res.json([]); return; }
    const partyRows = await db
      .select({ chainId: submissionChainAllowedPartiesTable.chainId })
      .from(submissionChainAllowedPartiesTable)
      .where(eq(submissionChainAllowedPartiesTable.orgId, userOrgId));
    visibleChainIds = partyRows.map(r => r.chainId);
    if (visibleChainIds.length === 0) { res.json([]); return; }
  }

  const base = chainSummarySelect().where(eq(submissionChainsTable.projectId, projectId));

  let chains = await base.orderBy(desc(submissionChainsTable.createdAt));

  // Filter in application layer (simpler than dynamic drizzle conditions here)
  if (visibleChainIds) {
    chains = chains.filter(c => visibleChainIds!.includes(c.id));
  }
  if (status) {
    chains = chains.filter(c => c.currentStatus === status);
  }
  if (orgFilter) {
    const oid = parseInt(orgFilter as string);
    chains = chains.filter(c => c.currentOrgId === oid || c.originatingOrgId === oid);
  }

  res.json(chains);
});

// ─── GET /members — project members in a given org (for user pickers) ─────────
// Usage: GET /api/projects/:projectId/submission-chains/members?orgId=5

router.get("/members", async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;

  if (!orgId) { res.status(400).json({ error: "orgId query parameter is required" }); return; }

  const members = await db
    .select({
      id:        usersTable.id,
      firstName: usersTable.firstName,
      lastName:  usersTable.lastName,
      email:     usersTable.email,
      role:      projectMembersTable.role,
    })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(usersTable.organizationId, orgId),
    ))
    .orderBy(asc(usersTable.firstName), asc(usersTable.lastName));

  res.json(members.map(m => ({
    id:   m.id,
    name: `${m.firstName} ${m.lastName}`,
    email: m.email,
    role: m.role,
  })));
});

// ─── GET /:id — chain detail ──────────────────────────────────────────────────

router.get("/:id", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }

  // Visibility: PM+ or member of allowed parties
  if (!isAtLeast(role, "project_manager")) {
    const allowed = await callerIsAllowedParty(id, userOrgId);
    if (!allowed) { res.status(403).json({ error: "You are not a party to this submission chain" }); return; }
  }

  const [parties, steps, documents] = await Promise.all([
    loadAllowedParties(id),
    loadSteps(id),
    loadChainDocuments(id),
  ]);

  // Org name enrichment for chain header
  const [originatingOrg] = await db
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, chain.originatingOrgId));
  const [currentOrg] = await db
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, chain.currentOrgId));

  res.json({
    ...chain,
    originatingOrgName: originatingOrg?.name ?? null,
    currentOrgName: currentOrg?.name ?? null,
    parties,
    steps,
    documents,
  });
});

// ─── POST / — create chain ────────────────────────────────────────────────────

router.post("/", async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "project_manager")) {
    res.status(403).json({ error: "Project Manager role or above required to create a submission chain" });
    return;
  }

  const { title, description, allowedParties } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

  // Validate allowedParties: must be an array of { orgId, stepOrder, label? }
  // At minimum 2 parties required (originator + one recipient)
  if (!Array.isArray(allowedParties) || allowedParties.length < 2) {
    res.status(400).json({ error: "At least 2 allowed parties are required (originator + at least one recipient)" });
    return;
  }

  // stepOrder must be unique consecutive integers starting at 1
  const orders = allowedParties.map((p: any) => parseInt(p.stepOrder)).sort((a, b) => a - b);
  if (orders[0] !== 1 || orders.some((o, i) => i > 0 && o !== orders[i - 1] + 1)) {
    res.status(400).json({ error: "stepOrder must be consecutive integers starting at 1" });
    return;
  }

  // The originating org = party with stepOrder 1 = caller's org
  const originatorParty = allowedParties.find((p: any) => parseInt(p.stepOrder) === 1);
  if (!originatorParty) { res.status(400).json({ error: "stepOrder 1 (originating party) is required" }); return; }

  const originatingOrgId = parseInt(originatorParty.orgId);
  const chainNumber = await generateChainNumber(projectId);

  const [chain] = await db.insert(submissionChainsTable).values({
    chainNumber,
    title: title.trim(),
    description: description?.trim() ?? null,
    projectId,
    originatingOrgId,
    currentOrgId: originatingOrgId,   // starts at originator
    createdById: req.user!.id,
    currentStatus: "draft",
    activeRevisionCycle: 1,
  }).returning();

  // Validate defaultAssigneeId for each party if provided
  for (const p of allowedParties) {
    if (p.defaultAssigneeId) {
      const valid = await validateAssignee(parseInt(p.defaultAssigneeId), parseInt(p.orgId), projectId);
      if (!valid) {
        res.status(400).json({ error: `Default assignee ${p.defaultAssigneeId} is not a member of org ${p.orgId} with project access` });
        return;
      }
    }
  }

  // Insert allowed parties
  await db.insert(submissionChainAllowedPartiesTable).values(
    allowedParties.map((p: any) => ({
      chainId: chain.id,
      orgId: parseInt(p.orgId),
      stepOrder: parseInt(p.stepOrder),
      label: p.label?.trim() ?? null,
      defaultAssigneeId: p.defaultAssigneeId ? parseInt(p.defaultAssigneeId) : null,
    })),
  );

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.created",
    entityType: "submission_chain",
    entityId: chain.id,
    entityTitle: chain.chainNumber,
    projectId,
  });

  res.status(201).json(chain);
});

// ─── PATCH /:id — update title / description ─────────────────────────────────

router.patch("/:id", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "project_manager")) {
    res.status(403).json({ error: "Project Manager role or above required" });
    return;
  }

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Only draft chains can be edited" });
    return;
  }

  const { title, description } = req.body;
  const updates: Partial<typeof chain> = { updatedAt: new Date() } as any;
  if (title !== undefined) (updates as any).title = title.trim();
  if (description !== undefined) (updates as any).description = description?.trim() ?? null;

  const [updated] = await db
    .update(submissionChainsTable)
    .set(updates as any)
    .where(eq(submissionChainsTable.id, id))
    .returning();

  res.json(updated);
});

// ─── DELETE /:id — delete draft chain ────────────────────────────────────────

router.delete("/:id", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "admin")) {
    res.status(403).json({ error: "Admin role or above required to delete a submission chain" });
    return;
  }

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Only draft chains can be deleted. Close the chain first." });
    return;
  }

  // Cascade deletes handle parties, steps, and documents
  await db.delete(submissionChainsTable).where(eq(submissionChainsTable.id, id));

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.deleted",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    projectId,
  });

  res.status(204).send();
});

// ─── POST /:id/parties — add an allowed party ────────────────────────────────

router.post("/:id/parties", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "project_manager")) {
    res.status(403).json({ error: "Project Manager role or above required" });
    return;
  }

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Parties can only be changed while the chain is in draft" });
    return;
  }

  const { orgId, stepOrder, label, defaultAssigneeId } = req.body;
  if (!orgId || !stepOrder) { res.status(400).json({ error: "orgId and stepOrder are required" }); return; }

  // Ensure stepOrder is not already taken
  const [existing] = await db
    .select({ id: submissionChainAllowedPartiesTable.id })
    .from(submissionChainAllowedPartiesTable)
    .where(
      and(
        eq(submissionChainAllowedPartiesTable.chainId, id),
        eq(submissionChainAllowedPartiesTable.stepOrder, parseInt(stepOrder)),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({ error: `stepOrder ${stepOrder} is already taken by another party` });
    return;
  }

  // Validate defaultAssigneeId if provided
  if (defaultAssigneeId) {
    const valid = await validateAssignee(parseInt(defaultAssigneeId), parseInt(orgId), projectId);
    if (!valid) {
      res.status(400).json({ error: "Default assignee must be a member of the specified organisation with project access" });
      return;
    }
  }

  const [party] = await db.insert(submissionChainAllowedPartiesTable).values({
    chainId: id,
    orgId: parseInt(orgId),
    stepOrder: parseInt(stepOrder),
    label: label?.trim() ?? null,
    defaultAssigneeId: defaultAssigneeId ? parseInt(defaultAssigneeId) : null,
  }).returning();

  res.status(201).json(party);
});

// ─── DELETE /:id/parties/:partyId — remove an allowed party ──────────────────

router.delete("/:id/parties/:partyId", async (req: Request<ProjectItemParams & { partyId: string }>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const partyId = requireInt(req.params.partyId);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "project_manager")) {
    res.status(403).json({ error: "Project Manager role or above required" });
    return;
  }

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Parties can only be changed while the chain is in draft" });
    return;
  }

  const [party] = await db
    .select()
    .from(submissionChainAllowedPartiesTable)
    .where(
      and(
        eq(submissionChainAllowedPartiesTable.id, partyId),
        eq(submissionChainAllowedPartiesTable.chainId, id),
      ),
    );
  if (!party) { res.status(404).json({ error: "Party not found" }); return; }
  if (party.stepOrder === 1) {
    res.status(400).json({ error: "Cannot remove the originating party (stepOrder 1)" });
    return;
  }

  await db.delete(submissionChainAllowedPartiesTable)
    .where(eq(submissionChainAllowedPartiesTable.id, partyId));

  res.status(204).send();
});

// ─── POST /:id/documents — add a document/revision to chain ──────────────────

router.post("/:id/documents", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Documents can only be added while the chain is in draft" });
    return;
  }

  // Only originating org's PM+ or DC may add documents
  const isOriginatingOrg = !userOrgId || userOrgId === chain.originatingOrgId;
  if (!isOriginatingOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the originating organisation's Document Controller or above may add documents" });
    return;
  }

  const { documentId, revisionId } = req.body;
  if (!documentId || !revisionId) {
    res.status(400).json({ error: "documentId and revisionId are required" });
    return;
  }

  // Verify the document belongs to this project
  const [doc] = await db
    .select({ id: documentsTable.id, projectId: documentsTable.projectId })
    .from(documentsTable)
    .where(and(eq(documentsTable.id, parseInt(documentId)), eq(documentsTable.projectId, projectId)));
  if (!doc) { res.status(404).json({ error: "Document not found in this project" }); return; }

  // Verify the revision belongs to the document
  const [rev] = await db
    .select({ id: documentRevisionsTable.id })
    .from(documentRevisionsTable)
    .where(
      and(
        eq(documentRevisionsTable.id, parseInt(revisionId)),
        eq(documentRevisionsTable.documentId, parseInt(documentId)),
      ),
    );
  if (!rev) { res.status(404).json({ error: "Revision not found for this document" }); return; }

  // Prevent duplicate document in the same cycle
  const [duplicate] = await db
    .select({ id: submissionChainDocumentsTable.id })
    .from(submissionChainDocumentsTable)
    .where(
      and(
        eq(submissionChainDocumentsTable.chainId, id),
        eq(submissionChainDocumentsTable.documentId, parseInt(documentId)),
        eq(submissionChainDocumentsTable.revisionCycle, chain.activeRevisionCycle),
      ),
    )
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: "This document is already in the current revision cycle of this chain" });
    return;
  }

  const [chainDoc] = await db.insert(submissionChainDocumentsTable).values({
    chainId: id,
    documentId: parseInt(documentId),
    revisionId: parseInt(revisionId),
    revisionCycle: chain.activeRevisionCycle,
    addedById: req.user!.id,
  }).returning();

  res.status(201).json(chainDoc);
});

// ─── DELETE /:id/documents/:chainDocId — remove document ─────────────────────

router.delete("/:id/documents/:chainDocId", async (req: Request<ProjectItemParams & { chainDocId: string }>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const chainDocId = requireInt(req.params.chainDocId);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Documents can only be removed while the chain is in draft" });
    return;
  }

  const isOriginatingOrg = !userOrgId || userOrgId === chain.originatingOrgId;
  if (!isOriginatingOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the originating organisation's Document Controller or above may remove documents" });
    return;
  }

  const [chainDoc] = await db
    .select()
    .from(submissionChainDocumentsTable)
    .where(
      and(
        eq(submissionChainDocumentsTable.id, chainDocId),
        eq(submissionChainDocumentsTable.chainId, id),
      ),
    );
  if (!chainDoc) { res.status(404).json({ error: "Chain document not found" }); return; }

  await db.delete(submissionChainDocumentsTable)
    .where(eq(submissionChainDocumentsTable.id, chainDocId));

  res.status(204).send();
});

// ─── POST /:id/activate — draft → active ─────────────────────────────────────

router.post("/:id/activate", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "draft") {
    res.status(409).json({ error: "Only draft chains can be activated" });
    return;
  }

  // Must be originating org's PM+ or DC
  const isOriginatingOrg = !userOrgId || userOrgId === chain.originatingOrgId;
  if (!isOriginatingOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the originating organisation's Document Controller or above may activate this chain" });
    return;
  }

  // Must have at least 1 document
  const docs = await loadChainDocuments(id, chain.activeRevisionCycle);
  if (docs.length === 0) {
    res.status(400).json({ error: "Add at least one document before activating" });
    return;
  }

  // Must have at least 2 allowed parties
  const parties = await loadAllowedParties(id);
  if (parties.length < 2) {
    res.status(400).json({ error: "At least 2 allowed parties (originator + one recipient) are required before activating" });
    return;
  }

  const [updated] = await db
    .update(submissionChainsTable)
    .set({
      currentStatus: "active",
      currentStepStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(submissionChainsTable.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.activated",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    projectId,
  });

  res.json(updated);
});

// ─── POST /:id/forward — forward to next party ───────────────────────────────

router.post("/:id/forward", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (!["active", "returned"].includes(chain.currentStatus)) {
    res.status(409).json({ error: "Only active or returned chains can be forwarded" });
    return;
  }

  // Must be current org holder, PM+ or DC
  const isCurrentOrg = !userOrgId || userOrgId === chain.currentOrgId;
  if (!isCurrentOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the current holder's Document Controller or above may forward this chain" });
    return;
  }

  const { reviewCode, comments, transmittalId, assignedToUserId: rawAssignedUserId } = req.body;

  // Validate reviewCode if provided
  if (reviewCode && !["A", "B", "C", "D"].includes(reviewCode)) {
    res.status(400).json({ error: "reviewCode must be A, B, C, or D" });
    return;
  }

  const parties = await loadAllowedParties(id);
  const currentPartyIndex = parties.findIndex(p => p.orgId === chain.currentOrgId);
  if (currentPartyIndex === -1) {
    res.status(500).json({ error: "Current org is not in the allowed parties list — data integrity error" });
    return;
  }

  // Step number = max existing step + 1
  const [maxStepRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(step_number), 0)` })
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id));
  const nextStepNumber = (maxStepRow?.max ?? 0) + 1;

  const nextParty = parties[currentPartyIndex + 1];

  if (!nextParty) {
    // This is the final step — the chain has completed its full circuit
    // Determine outcome: if every forward step in this cycle has reviewCode A → approved
    const cycleSteps = await db
      .select({ reviewCode: submissionChainStepsTable.reviewCode, action: submissionChainStepsTable.action })
      .from(submissionChainStepsTable)
      .where(
        and(
          eq(submissionChainStepsTable.chainId, id),
          eq(submissionChainStepsTable.revisionCycle, chain.activeRevisionCycle),
        ),
      );

    const forwardStepCodes = [
      ...cycleSteps.filter(s => s.action === "forward" && s.reviewCode).map(s => s.reviewCode),
      reviewCode ?? null,
    ].filter(Boolean);

    const allCodeA = forwardStepCodes.length > 0 && forwardStepCodes.every(c => c === "A");
    const finalStatus = allCodeA ? "approved" : "approved_with_comments";

    // Record the final step first
    await db.insert(submissionChainStepsTable).values({
      chainId: id,
      stepNumber: nextStepNumber,
      revisionCycle: chain.activeRevisionCycle,
      action: "forward",
      fromOrgId: chain.currentOrgId,
      toOrgId: chain.currentOrgId,  // no next party — stays at final org, chain closes
      actionedById: req.user!.id,
      stepStatus: "actioned",
      reviewCode: reviewCode ?? null,
      comments: comments?.trim() ?? null,
      reviewedById: reviewCode ? req.user!.id : null,
      reviewedAt: reviewCode ? new Date() : null,
      transmittalId: transmittalId ? parseInt(transmittalId) : null,
    });

    const [updated] = await db
      .update(submissionChainsTable)
      .set({
        currentStatus: finalStatus,
        autoClosedAt: allCodeA ? new Date() : null,
        currentStepStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    await createAuditLog({
      userId: req.user!.id,
      organizationId: req.user!.organizationId ?? undefined,
      action: `submission_chain.${finalStatus}`,
      entityType: "submission_chain",
      entityId: id,
      entityTitle: chain.chainNumber,
      details: { reviewCode: reviewCode ?? null },
      projectId,
    });

    res.json({ chain: updated, finalised: true, outcome: finalStatus });
    return;
  }

  // Resolve assignee for the next party:
  // 1. Use explicitly provided assignedToUserId (validated)
  // 2. Fall back to the next party's defaultAssigneeId
  let resolvedAssigneeId: number | null = null;

  if (rawAssignedUserId) {
    const valid = await validateAssignee(parseInt(rawAssignedUserId), nextParty.orgId!, projectId);
    if (!valid) {
      res.status(400).json({ error: "Assigned user must be a member of the receiving organisation with project access" });
      return;
    }
    resolvedAssigneeId = parseInt(rawAssignedUserId);
  } else if (nextParty.defaultAssigneeId) {
    resolvedAssigneeId = nextParty.defaultAssigneeId;
  }

  // Normal forward — move to next party
  await db.insert(submissionChainStepsTable).values({
    chainId: id,
    stepNumber: nextStepNumber,
    revisionCycle: chain.activeRevisionCycle,
    action: "forward",
    fromOrgId: chain.currentOrgId,
    toOrgId: nextParty.orgId!,
    actionedById: req.user!.id,
    stepStatus: "actioned",
    reviewCode: reviewCode ?? null,
    comments: comments?.trim() ?? null,
    reviewedById: reviewCode ? req.user!.id : null,
    reviewedAt: reviewCode ? new Date() : null,
    transmittalId: transmittalId ? parseInt(transmittalId) : null,
    assignedToUserId: resolvedAssigneeId,
  });

  const [updated] = await db
    .update(submissionChainsTable)
    .set({
      currentOrgId: nextParty.orgId!,
      currentStatus: "active",
      currentStepStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(submissionChainsTable.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.forwarded",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    details: { toOrgId: nextParty.orgId, reviewCode: reviewCode ?? null, assignedToUserId: resolvedAssigneeId },
    projectId,
  });

  // Notify assigned user (or DC+ fallback) in the receiving org — fire-and-forget
  stepNotificationRecipients(resolvedAssigneeId, nextParty.orgId!, projectId).then(recipients => {
    if (recipients.length === 0) return;
    dispatchNotification({
      event: "submission_chain.forwarded",
      recipients,
      organizationId: nextParty.orgId!,
      entityType: "submission_chain",
      entityId: id,
      sendEmail: (emails) => sendEmail(
        emails,
        `Submission Chain ${chain.chainNumber} forwarded to you`,
        `<p>A submission chain (<strong>${chain.chainNumber}</strong> — ${chain.title}) has been forwarded to your organisation for review.</p>
         ${resolvedAssigneeId ? `<p>You have been assigned as the responsible reviewer.</p>` : ""}
         <p>Please log in to ArcScale EDMS to review and action this submission.</p>`,
      ),
    });
  }).catch(() => {}); // silent — notifications must never block the response

  res.json({ chain: updated, finalised: false });
});

// ─── POST /:id/return — return to previous party ─────────────────────────────

router.post("/:id/return", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "active") {
    res.status(409).json({ error: "Only active chains can be returned" });
    return;
  }

  const isCurrentOrg = !userOrgId || userOrgId === chain.currentOrgId;
  if (!isCurrentOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the current holder's Document Controller or above may return this chain" });
    return;
  }

  const { reviewCode, comments, transmittalId } = req.body;
  if (!comments?.trim()) {
    res.status(400).json({ error: "A return reason (comments) is required when returning a submission" });
    return;
  }
  if (reviewCode && !["A", "B", "C", "D"].includes(reviewCode)) {
    res.status(400).json({ error: "reviewCode must be A, B, C, or D" });
    return;
  }

  const parties = await loadAllowedParties(id);
  const currentPartyIndex = parties.findIndex(p => p.orgId === chain.currentOrgId);
  if (currentPartyIndex === -1) {
    res.status(500).json({ error: "Current org is not in the allowed parties list — data integrity error" });
    return;
  }

  const [maxStepRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(step_number), 0)` })
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id));
  const nextStepNumber = (maxStepRow?.max ?? 0) + 1;

  // Returning from the originator (stepOrder 1) is not allowed — they have nowhere to go back to
  if (currentPartyIndex === 0) {
    res.status(400).json({ error: "The originating party cannot return the submission — use Close instead" });
    return;
  }

  const prevParty = parties[currentPartyIndex - 1];
  const returningToOriginator = prevParty.stepOrder === 1;

  // Resolve assignee for the receiving (previous) party:
  // Use their defaultAssigneeId, or fall back to any DC+ in the org
  const returnAssigneeId = prevParty.defaultAssigneeId ?? null;

  await db.insert(submissionChainStepsTable).values({
    chainId: id,
    stepNumber: nextStepNumber,
    revisionCycle: chain.activeRevisionCycle,
    action: "return",
    fromOrgId: chain.currentOrgId,
    toOrgId: prevParty.orgId!,
    actionedById: req.user!.id,
    stepStatus: "actioned",
    reviewCode: reviewCode ?? null,
    comments: comments.trim(),
    reviewedById: req.user!.id,
    reviewedAt: new Date(),
    transmittalId: transmittalId ? parseInt(transmittalId) : null,
    assignedToUserId: returnAssigneeId,
  });

  const newStatus = returningToOriginator ? "returned" : "active";

  const [updated] = await db
    .update(submissionChainsTable)
    .set({
      currentOrgId: prevParty.orgId!,
      currentStatus: newStatus,
      currentStepStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(submissionChainsTable.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.returned",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    details: { toOrgId: prevParty.orgId, reviewCode: reviewCode ?? null, returningToOriginator },
    projectId,
  });

  // Notify assignee (or DC+ fallback) at the receiving org — fire-and-forget
  stepNotificationRecipients(returnAssigneeId, prevParty.orgId!, projectId).then(recipients => {
    if (recipients.length === 0) return;
    dispatchNotification({
      event: "submission_chain.returned",
      recipients,
      organizationId: prevParty.orgId!,
      entityType: "submission_chain",
      entityId: id,
      sendEmail: (emails) => sendEmail(
        emails,
        `Submission Chain ${chain.chainNumber} returned to your organisation`,
        `<p>Submission chain <strong>${chain.chainNumber}</strong> (${chain.title}) has been returned to your organisation for revision.</p>
         <p><strong>Reason:</strong> ${comments.trim()}</p>
         <p>Please log in to ArcScale EDMS to review comments and prepare a resubmission.</p>`,
      ),
    });
  }).catch(() => {});

  res.json({ chain: updated, returningToOriginator });
});

// ─── POST /:id/resubmit — returned → active (originator resubmits) ─────────────

router.post("/:id/resubmit", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus !== "returned") {
    res.status(409).json({ error: "Only returned chains can be resubmitted" });
    return;
  }

  const isOriginatingOrg = !userOrgId || userOrgId === chain.originatingOrgId;
  if (!isOriginatingOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the originating organisation's Document Controller or above may resubmit" });
    return;
  }

  // Bump the revision cycle — the originator is expected to have updated document revisions
  // before resubmitting. All new documents should be added via PATCH to the chain first,
  // then resubmit increments the cycle so old cycle docs are preserved.
  const newCycle = chain.activeRevisionCycle + 1;

  // Require at least 1 document in the new cycle if any were added
  const newCycleDocs = await loadChainDocuments(id, newCycle);
  // Note: resubmit with the same cycle documents is allowed (no new revisions yet)
  // The cycle only increments to segregate history.

  const [maxStepRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(step_number), 0)` })
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id));
  const nextStepNumber = (maxStepRow?.max ?? 0) + 1;

  // Get the first non-originator party (step 2) as the next destination
  const parties = await loadAllowedParties(id);
  const firstRecipient = parties.find(p => p.stepOrder === 2);
  if (!firstRecipient) {
    res.status(400).json({ error: "Cannot resubmit — no recipient party defined at stepOrder 2" });
    return;
  }

  const { comments, assignedToUserId: rawAssignedUserId } = req.body;

  // Resolve assignee for the first recipient:
  let resolvedAssigneeId: number | null = null;
  if (rawAssignedUserId) {
    const valid = await validateAssignee(parseInt(rawAssignedUserId), firstRecipient.orgId!, projectId);
    if (!valid) {
      res.status(400).json({ error: "Assigned user must be a member of the receiving organisation with project access" });
      return;
    }
    resolvedAssigneeId = parseInt(rawAssignedUserId);
  } else if (firstRecipient.defaultAssigneeId) {
    resolvedAssigneeId = firstRecipient.defaultAssigneeId;
  }

  await db.insert(submissionChainStepsTable).values({
    chainId: id,
    stepNumber: nextStepNumber,
    revisionCycle: newCycle,
    action: "forward",
    fromOrgId: chain.originatingOrgId,
    toOrgId: firstRecipient.orgId!,
    actionedById: req.user!.id,
    stepStatus: "actioned",
    reviewCode: null,
    comments: comments?.trim() ?? null,
    assignedToUserId: resolvedAssigneeId,
  });

  const [updated] = await db
    .update(submissionChainsTable)
    .set({
      currentOrgId: firstRecipient.orgId!,
      currentStatus: "active",
      activeRevisionCycle: newCycle,
      currentStepStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(submissionChainsTable.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.resubmitted",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    details: { newRevisionCycle: newCycle, assignedToUserId: resolvedAssigneeId },
    projectId,
  });

  // Notify assignee (or DC+ fallback) at the first recipient org — fire-and-forget
  stepNotificationRecipients(resolvedAssigneeId, firstRecipient.orgId!, projectId).then(recipients => {
    if (recipients.length === 0) return;
    dispatchNotification({
      event: "submission_chain.forwarded",
      recipients,
      organizationId: firstRecipient.orgId!,
      entityType: "submission_chain",
      entityId: id,
      sendEmail: (emails) => sendEmail(
        emails,
        `Submission Chain ${chain.chainNumber} resubmitted — Cycle ${newCycle}`,
        `<p>Submission chain <strong>${chain.chainNumber}</strong> (${chain.title}) has been resubmitted for review (Cycle ${newCycle}).</p>
         <p>Please log in to ArcScale EDMS to review the updated documents and action this submission.</p>`,
      ),
    });
  }).catch(() => {});

  res.json(updated);
});

// ─── POST /:id/close — manually close ────────────────────────────────────────

router.post("/:id/close", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  if (!isAtLeast(role, "project_manager")) {
    res.status(403).json({ error: "Project Manager role or above required to close a submission chain" });
    return;
  }

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }
  if (chain.currentStatus === "closed") {
    res.status(409).json({ error: "Chain is already closed" });
    return;
  }

  const { reason } = req.body;

  const [updated] = await db
    .update(submissionChainsTable)
    .set({
      currentStatus: "closed",
      updatedAt: new Date(),
    })
    .where(eq(submissionChainsTable.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.closed",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    details: { reason: reason?.trim() ?? null, previousStatus: chain.currentStatus },
    projectId,
  });

  res.json(updated);
});

// ─── POST /:id/reassign — reassign current step to another user in same org ───
// Permission: DC+ or PM within currentOrgId.
// The new assignee must belong to currentOrgId and have project access.

router.post("/:id/reassign", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }

  if (!["active", "returned"].includes(chain.currentStatus)) {
    res.status(409).json({ error: "Reassignment is only allowed on active or returned chains" });
    return;
  }

  // Caller must be in currentOrgId and at least DC
  const isCurrentOrg = !userOrgId || userOrgId === chain.currentOrgId;
  if (!isCurrentOrg || !isAtLeast(role, "document_controller")) {
    res.status(403).json({ error: "Only the current holder organisation's Document Controller or above may reassign this step" });
    return;
  }

  const { newAssigneeId, reason } = req.body;
  if (!newAssigneeId) { res.status(400).json({ error: "newAssigneeId is required" }); return; }

  // Validate the new assignee: must be in currentOrgId + project access
  const newAssignee = await validateAssignee(parseInt(newAssigneeId), chain.currentOrgId, projectId);
  if (!newAssignee) {
    res.status(400).json({ error: "New assignee must be a member of the current holder organisation with project access" });
    return;
  }

  // Find the latest step for this chain (the one currently pending action)
  const [latestStep] = await db
    .select({ id: submissionChainStepsTable.id, stepNumber: submissionChainStepsTable.stepNumber })
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id))
    .orderBy(desc(submissionChainStepsTable.stepNumber))
    .limit(1);

  if (!latestStep) {
    res.status(400).json({ error: "No steps found for this chain — cannot reassign" });
    return;
  }

  // Update the latest step's assignment
  await db
    .update(submissionChainStepsTable)
    .set({
      assignedToUserId: parseInt(newAssigneeId),
      reassignedAt: new Date(),
      reassignedById: req.user!.id,
    })
    .where(eq(submissionChainStepsTable.id, latestStep.id));

  await createAuditLog({
    userId: req.user!.id,
    organizationId: req.user!.organizationId ?? undefined,
    action: "submission_chain.reassigned",
    entityType: "submission_chain",
    entityId: id,
    entityTitle: chain.chainNumber,
    details: { newAssigneeId: parseInt(newAssigneeId), reason: reason?.trim() ?? null },
    projectId,
  });

  // Notify the newly assigned user — fire-and-forget
  dispatchNotification({
    event: "submission_chain.reassigned",
    recipients: [{ userId: newAssignee.id, email: newAssignee.email, name: `${newAssignee.firstName} ${newAssignee.lastName}` }],
    organizationId: chain.currentOrgId,
    entityType: "submission_chain",
    entityId: id,
    sendEmail: (emails) => sendEmail(
      emails,
      `Submission Chain ${chain.chainNumber} assigned to you`,
      `<p>You have been assigned as the responsible reviewer for submission chain <strong>${chain.chainNumber}</strong> (${chain.title}).</p>
       ${reason ? `<p><strong>Note from assignor:</strong> ${reason.trim()}</p>` : ""}
       <p>Please log in to ArcScale EDMS to review and action this submission.</p>`,
    ),
  }).catch(() => {});

  res.json({ success: true, newAssigneeId: newAssignee.id, newAssigneeName: `${newAssignee.firstName} ${newAssignee.lastName}` });
});

// ─── GET /:id/steps — step history ───────────────────────────────────────────

router.get("/:id/steps", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const role = await effectiveRole(req, projectId);
  const userOrgId = req.user!.organizationId;

  const chain = await loadChain(id, projectId);
  if (!chain) { res.status(404).json({ error: "Submission chain not found" }); return; }

  if (!isAtLeast(role, "project_manager")) {
    const allowed = await callerIsAllowedParty(id, userOrgId);
    if (!allowed) { res.status(403).json({ error: "You are not a party to this submission chain" }); return; }
  }

  const steps = await loadSteps(id);
  res.json(steps);
});

export default router;
