import { Router } from "express";
import { db } from "@workspace/db";
import {
  submissionChainsTable,
  submissionChainStepsTable,
  submissionChainDocumentsTable,
  submissionChainAllowedPartiesTable,
  projectsTable,
  projectParticipantsTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, or, desc, asc } from "drizzle-orm";
import { requireAuth, isSystemOwner } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { requireInt } from "../lib/params.js";
import type { Request, Response } from "express";
import type { ProjectParams, ProjectItemParams } from "../lib/params.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Resolve the project_participant that represents the caller's organisation.
// Relies on organisations.entity_id (Phase 1 migration 0022) to link an org
// to its canonical entity, then looks up that entity in project_participants.
// Returns null when the org has no entity_id set or the entity is not a
// participant in this project.
async function resolveCallerParticipant(projectId: number, callerOrgId: number) {
  const [org] = await db
    .select({ entityId: organizationsTable.entityId })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, callerOrgId));

  if (!org?.entityId) return null;

  const [participant] = await db
    .select()
    .from(projectParticipantsTable)
    .where(
      and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.entityId, org.entityId),
      ),
    );

  return participant ?? null;
}

// Resolve an org id from a participant (participant → entity → org).
// Falls back to fallbackOrgId when no org-entity link exists (single-tenant
// where entities are not yet linked to specific orgs).
async function resolveOrgFromParticipant(
  participantId: number,
  fallbackOrgId: number,
): Promise<number> {
  const [participant] = await db
    .select({ entityId: projectParticipantsTable.entityId })
    .from(projectParticipantsTable)
    .where(eq(projectParticipantsTable.id, participantId));

  if (!participant) return fallbackOrgId;

  const [org] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.entityId, participant.entityId))
    .limit(1);

  return org?.id ?? fallbackOrgId;
}

// ─── List chains ──────────────────────────────────────────────────────────────

router.get("/", async (req: Request<ProjectParams>, res: Response): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const caller = req.user!;
  const { type, status } = req.query as { type?: string; status?: string };

  let chains = await db
    .select()
    .from(submissionChainsTable)
    .where(
      isSystemOwner(caller)
        ? eq(submissionChainsTable.projectId, projectId)
        : and(
            eq(submissionChainsTable.projectId, projectId),
            or(
              eq(submissionChainsTable.originatingOrgId, caller.organizationId!),
              eq(submissionChainsTable.currentOrgId, caller.organizationId!),
            ),
          ),
    )
    .orderBy(desc(submissionChainsTable.createdAt));

  if (type) chains = chains.filter((c) => c.type === type);
  if (status) chains = chains.filter((c) => c.currentStatus === status);

  res.json(chains);
});

// ─── Create chain ─────────────────────────────────────────────────────────────

router.post(
  "/",
  requireMinRole("document_controller"),
  async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const { title, description, type, documentIds } = req.body;

    if (!title) { res.status(400).json({ error: "Title is required" }); return; }
    if (!req.user!.organizationId) {
      res.status(400).json({ error: "User must belong to an organisation" });
      return;
    }

    const chainType = type ?? "submittal";
    const validTypes = ["submittal", "rfi", "ncr", "mir"];
    if (!validTypes.includes(chainType)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
      return;
    }

    const existing = await db
      .select({ id: submissionChainsTable.id })
      .from(submissionChainsTable)
      .where(eq(submissionChainsTable.projectId, projectId));

    const seq = String(existing.length + 1).padStart(4, "0");
    const [project] = await db
      .select({ code: projectsTable.code })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    const chainNumber = `SC-${project?.code ?? "PRJ"}-${seq}`;

    const [chain] = await db
      .insert(submissionChainsTable)
      .values({
        chainNumber,
        title,
        description: description ?? null,
        type: chainType,
        projectId,
        originatingOrgId: req.user!.organizationId,
        currentOrgId: req.user!.organizationId,
        currentStatus: "active",
        activeRevisionCycle: 1,
        createdById: req.user!.id,
      })
      .returning();

    let documents: typeof submissionChainDocumentsTable.$inferSelect[] = [];
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      await db.insert(submissionChainDocumentsTable).values(
        documentIds.map((d: { documentId: number; revisionId: number }) => ({
          chainId: chain.id,
          documentId: d.documentId,
          revisionId: d.revisionId,
          revisionCycle: 1,
          addedById: req.user!.id,
        })),
      );
      documents = await db
        .select()
        .from(submissionChainDocumentsTable)
        .where(eq(submissionChainDocumentsTable.chainId, chain.id));
    }

    res.status(201).json({ ...chain, documents });
  },
);

// ─── Action permission helper ─────────────────────────────────────────────────
// Pure function (no DB calls). Computes which actions the caller may perform
// given the current chain state, the configured party sequence, and identity.
//
// canSetupParties  — parties not yet defined AND chain has no steps; only the
//                    originating org (or system_owner) may call setup-parties.
// canReview        — chain is active AND caller is the current custodian.
// canForward       — same conditions as canReview.
// canReturn        — same as canForward but blocked for stepOrder=1 (originator).
// canResubmit      — chain is 'returned' AND caller is the originator (stepOrder=1).

type ChainActions = {
  canSetupParties: boolean;
  canReview: boolean;
  canForward: boolean;
  canReturn: boolean;
  canResubmit: boolean;
};

function computeActions(
  chain: typeof submissionChainsTable.$inferSelect,
  parties: typeof submissionChainAllowedPartiesTable.$inferSelect[],
  steps: typeof submissionChainStepsTable.$inferSelect[],
  callerParticipantId: number | null,
  callerOrgId: number | null,
  isSysOwner: boolean,
): ChainActions {
  const partiesReady = parties.length > 0;
  const noStepsYet = steps.length === 0;

  if (isSysOwner) {
    return {
      canSetupParties: !partiesReady && noStepsYet,
      canReview:       chain.currentStatus === "active"   && partiesReady,
      canForward:      chain.currentStatus === "active"   && partiesReady,
      canReturn:       chain.currentStatus === "active"   && partiesReady,
      canResubmit:     chain.currentStatus === "returned" && partiesReady,
    };
  }

  const isCurrentCustodian =
    partiesReady &&
    callerParticipantId !== null &&
    chain.currentParticipantId === callerParticipantId;

  const callerParty = parties.find((p) => p.participantId === callerParticipantId);
  const isOriginator = callerParty?.stepOrder === 1;

  return {
    canSetupParties: !partiesReady && noStepsYet && callerOrgId === chain.originatingOrgId,
    canReview:       chain.currentStatus === "active"   && isCurrentCustodian,
    canForward:      chain.currentStatus === "active"   && isCurrentCustodian,
    canReturn:       chain.currentStatus === "active"   && isCurrentCustodian && !isOriginator,
    canResubmit:     chain.currentStatus === "returned" && isOriginator,
  };
}

// ─── Get chain detail ─────────────────────────────────────────────────────────

router.get("/:id", async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const caller = req.user!;

  const [chain] = await db
    .select()
    .from(submissionChainsTable)
    .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

  if (!chain) { res.status(404).json({ error: "Not found" }); return; }

  // Resolve caller's participant once — used for both access check and computeActions.
  const callerParticipant = caller.organizationId
    ? await resolveCallerParticipant(projectId, caller.organizationId)
    : null;

  if (!isSystemOwner(caller)) {
    let hasAccess = false;

    // Primary: caller's participant is in this chain's allowed_parties
    if (callerParticipant) {
      const [inParties] = await db
        .select({ id: submissionChainAllowedPartiesTable.id })
        .from(submissionChainAllowedPartiesTable)
        .where(
          and(
            eq(submissionChainAllowedPartiesTable.chainId, id),
            eq(submissionChainAllowedPartiesTable.participantId, callerParticipant.id),
          ),
        )
        .limit(1);
      if (inParties) hasAccess = true;
    }

    // Fallback: legacy org-based check (pre-Phase-3 chains)
    if (!hasAccess) {
      if (
        chain.originatingOrgId === caller.organizationId ||
        chain.currentOrgId === caller.organizationId
      ) {
        hasAccess = true;
      }
    }

    // Last resort: caller appeared in any step
    if (!hasAccess) {
      const [inStep] = await db
        .select({ id: submissionChainStepsTable.id })
        .from(submissionChainStepsTable)
        .where(
          and(
            eq(submissionChainStepsTable.chainId, id),
            or(
              eq(submissionChainStepsTable.fromOrgId, caller.organizationId!),
              eq(submissionChainStepsTable.toOrgId, caller.organizationId!),
            ),
          ),
        )
        .limit(1);
      if (inStep) hasAccess = true;
    }

    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const steps = await db
    .select()
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id))
    .orderBy(asc(submissionChainStepsTable.stepNumber));

  const documents = await db
    .select()
    .from(submissionChainDocumentsTable)
    .where(eq(submissionChainDocumentsTable.chainId, id));

  const parties = await db
    .select()
    .from(submissionChainAllowedPartiesTable)
    .where(eq(submissionChainAllowedPartiesTable.chainId, id))
    .orderBy(asc(submissionChainAllowedPartiesTable.stepOrder));

  const actions = computeActions(
    chain,
    parties,
    steps,
    callerParticipant?.id ?? null,
    caller.organizationId ?? null,
    isSystemOwner(caller),
  );

  res.json({ ...chain, steps, documents, parties, actions });
});

// ─── Setup parties ────────────────────────────────────────────────────────────
// Defines the participant sequence for a chain. Must be called before the
// first forward. Cannot be modified once the chain has steps.

router.post(
  "/:id/setup-parties",
  requireMinRole("document_controller"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { parties } = req.body as {
      parties?: Array<{
        participantId: number;
        stepOrder: number;
        label?: string;
        assignmentStrategy: "named" | "role_based";
        defaultAssigneeId?: number;
      }>;
    };

    if (!parties || !Array.isArray(parties) || parties.length === 0) {
      res.status(400).json({ error: "parties array is required and must not be empty" });
      return;
    }

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    // Reject modification once the chain has moved
    const [firstStep] = await db
      .select({ id: submissionChainStepsTable.id })
      .from(submissionChainStepsTable)
      .where(eq(submissionChainStepsTable.chainId, id))
      .limit(1);

    if (firstStep) {
      res.status(409).json({
        error: "CHAIN_IN_MOTION",
        message: "Party configuration cannot be changed after forwarding has begun.",
      });
      return;
    }

    // stepOrder 1 (originator) is mandatory
    if (!parties.some((p) => p.stepOrder === 1)) {
      res.status(400).json({ error: "stepOrder 1 (originator) is required" });
      return;
    }

    // stepOrders must be unique
    const stepOrders = parties.map((p) => p.stepOrder);
    if (new Set(stepOrders).size !== stepOrders.length) {
      res.status(400).json({ error: "stepOrder values must be unique" });
      return;
    }

    // Validate each party entry
    for (const party of parties) {
      if (!party.participantId || !party.stepOrder || !party.assignmentStrategy) {
        res.status(400).json({
          error: "Each party requires participantId, stepOrder, and assignmentStrategy",
        });
        return;
      }

      if ((party.assignmentStrategy as string) === "unassigned") {
        res.status(400).json({
          error: "UNASSIGNED_NOT_SUPPORTED",
          message:
            "assignmentStrategy 'unassigned' is reserved for a future release. Use 'named' or 'role_based'.",
        });
        return;
      }

      if (party.assignmentStrategy === "named" && !party.defaultAssigneeId) {
        res.status(400).json({
          error: "defaultAssigneeId is required when assignmentStrategy is 'named'",
        });
        return;
      }

      const [participant] = await db
        .select({ id: projectParticipantsTable.id })
        .from(projectParticipantsTable)
        .where(
          and(
            eq(projectParticipantsTable.id, party.participantId),
            eq(projectParticipantsTable.projectId, projectId),
          ),
        );

      if (!participant) {
        res.status(400).json({
          error: `participantId ${party.participantId} does not belong to project ${projectId}`,
        });
        return;
      }
    }

    // Upsert: replace all parties atomically
    await db
      .delete(submissionChainAllowedPartiesTable)
      .where(eq(submissionChainAllowedPartiesTable.chainId, id));

    await db.insert(submissionChainAllowedPartiesTable).values(
      parties.map((p) => ({
        chainId: id,
        participantId: p.participantId,
        stepOrder: p.stepOrder,
        label: p.label ?? null,
        assignmentStrategy: p.assignmentStrategy as "named" | "role_based",
        defaultAssigneeId: p.defaultAssigneeId ?? null,
        orgId: null,
      })),
    );

    // Set current custodian to the originator (stepOrder=1)
    const originatorParty = parties.find((p) => p.stepOrder === 1)!;
    const resolvedOrgId = await resolveOrgFromParticipant(
      originatorParty.participantId,
      req.user!.organizationId!,
    );

    const [updatedChain] = await db
      .update(submissionChainsTable)
      .set({
        currentParticipantId: originatorParty.participantId,
        currentOrgId: resolvedOrgId,
        updatedAt: new Date(),
      })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    const insertedParties = await db
      .select()
      .from(submissionChainAllowedPartiesTable)
      .where(eq(submissionChainAllowedPartiesTable.chainId, id))
      .orderBy(asc(submissionChainAllowedPartiesTable.stepOrder));

    res.json({ chain: updatedChain, parties: insertedParties });
  },
);

// ─── Forward chain custody ─────────────────────────────────────────────────────
// Moves the chain to the next party in sequence (stepOrder + 1).
// Only the current custodian may forward. toParticipantId must match the
// next configured step in allowed_parties.

router.post(
  "/:id/forward",
  requireMinRole("document_controller"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { toParticipantId, assignedToUserId, transmittalId } = req.body;

    if (!toParticipantId) {
      res.status(400).json({ error: "toParticipantId is required" });
      return;
    }

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    if (chain.currentStatus !== "active") {
      res.status(409).json({
        error: "CHAIN_NOT_ACTIVE",
        message: `Chain is in status '${chain.currentStatus}'. Only active chains can be forwarded.`,
      });
      return;
    }

    const caller = req.user!;

    // Authorise: caller must be the current custodian (system_owner always bypasses)
    if (!isSystemOwner(caller)) {
      if (chain.currentParticipantId !== null) {
        const callerParticipant = caller.organizationId
          ? await resolveCallerParticipant(projectId, caller.organizationId)
          : null;

        if (!callerParticipant || callerParticipant.id !== chain.currentParticipantId) {
          res.status(403).json({
            error: "Forbidden",
            message: "Only the current custodian participant can forward this chain.",
            currentCustodianParticipantId: chain.currentParticipantId,
          });
          return;
        }
      } else if (chain.currentOrgId !== caller.organizationId) {
        // Legacy fallback: org-based check for chains without participant wiring
        res.status(403).json({
          error: "Forbidden",
          message: "Only the current custodian organisation can forward this chain.",
          currentCustodianOrgId: chain.currentOrgId,
        });
        return;
      }
    }

    // Validate toParticipantId is next in allowed sequence (when parties are configured)
    if (chain.currentParticipantId !== null) {
      const [currentParty] = await db
        .select({ stepOrder: submissionChainAllowedPartiesTable.stepOrder })
        .from(submissionChainAllowedPartiesTable)
        .where(
          and(
            eq(submissionChainAllowedPartiesTable.chainId, id),
            eq(submissionChainAllowedPartiesTable.participantId, chain.currentParticipantId),
          ),
        );

      const [targetParty] = await db
        .select({ stepOrder: submissionChainAllowedPartiesTable.stepOrder })
        .from(submissionChainAllowedPartiesTable)
        .where(
          and(
            eq(submissionChainAllowedPartiesTable.chainId, id),
            eq(submissionChainAllowedPartiesTable.participantId, toParticipantId),
          ),
        );

      if (!targetParty) {
        res.status(400).json({
          error: "toParticipantId is not a configured party for this chain",
        });
        return;
      }

      if (currentParty && targetParty.stepOrder !== currentParty.stepOrder + 1) {
        res.status(400).json({
          error: "SEQUENCE_VIOLATION",
          message:
            `toParticipantId must be at stepOrder ${currentParty.stepOrder + 1}. ` +
            `Requested participant is at stepOrder ${targetParty.stepOrder}.`,
        });
        return;
      }
    }

    // Resolve org ids for backward-compat step columns
    const fromOrgId = await resolveOrgFromParticipant(
      chain.currentParticipantId ?? 0,
      caller.organizationId!,
    );
    const toOrgId = await resolveOrgFromParticipant(toParticipantId, caller.organizationId!);

    const allSteps = await db
      .select({ stepNumber: submissionChainStepsTable.stepNumber })
      .from(submissionChainStepsTable)
      .where(eq(submissionChainStepsTable.chainId, id));

    const [step] = await db
      .insert(submissionChainStepsTable)
      .values({
        chainId: id,
        stepNumber: allSteps.length + 1,
        revisionCycle: chain.activeRevisionCycle,
        action: "forward",
        fromOrgId,
        toOrgId,
        fromParticipantId: chain.currentParticipantId,
        toParticipantId,
        actionedById: caller.id,
        stepStatus: "actioned",
        assignedToUserId: assignedToUserId ?? null,
        transmittalId: transmittalId ?? null,
      })
      .returning();

    const [updatedChain] = await db
      .update(submissionChainsTable)
      .set({
        currentOrgId: toOrgId,
        currentParticipantId: toParticipantId,
        currentStepStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    res.json({ chain: updatedChain, step });
  },
);

// ─── Record review ────────────────────────────────────────────────────────────
// The current custodian records their review code + comments against the
// incoming step. The chain does NOT move — forward or return must be called
// separately.

router.post(
  "/:id/review",
  requireMinRole("reviewer"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { reviewCode, comments } = req.body;

    const validCodes = ["A", "B", "C", "D"];
    if (!reviewCode || !validCodes.includes(reviewCode)) {
      res.status(400).json({ error: "reviewCode is required and must be A, B, C, or D" });
      return;
    }

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    if (chain.currentStatus !== "active") {
      res.status(409).json({
        error: "CHAIN_NOT_ACTIVE",
        message: `Chain is in status '${chain.currentStatus}'. Only active chains can be reviewed.`,
      });
      return;
    }

    const caller = req.user!;

    if (!isSystemOwner(caller)) {
      if (chain.currentParticipantId !== null) {
        const callerParticipant = caller.organizationId
          ? await resolveCallerParticipant(projectId, caller.organizationId)
          : null;

        if (!callerParticipant || callerParticipant.id !== chain.currentParticipantId) {
          res.status(403).json({
            error: "Forbidden",
            message: "Only the current custodian can record a review.",
          });
          return;
        }
      } else if (chain.currentOrgId !== caller.organizationId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    // Find the latest incoming step (the step that brought the chain to the caller)
    const [incomingStep] = await db
      .select()
      .from(submissionChainStepsTable)
      .where(
        and(
          eq(submissionChainStepsTable.chainId, id),
          chain.currentParticipantId
            ? eq(submissionChainStepsTable.toParticipantId, chain.currentParticipantId)
            : eq(submissionChainStepsTable.toOrgId, caller.organizationId!),
        ),
      )
      .orderBy(desc(submissionChainStepsTable.stepNumber))
      .limit(1);

    if (!incomingStep) {
      res.status(400).json({
        error: "NO_INCOMING_STEP",
        message: "No incoming step found. Forward the chain to this party first.",
      });
      return;
    }

    const [updatedStep] = await db
      .update(submissionChainStepsTable)
      .set({
        reviewCode,
        comments: comments ?? null,
        reviewedById: caller.id,
        reviewedAt: new Date(),
      })
      .where(eq(submissionChainStepsTable.id, incomingStep.id))
      .returning();

    res.json({ step: updatedStep, chain });
  },
);

// ─── Return chain ─────────────────────────────────────────────────────────────
// Returns the chain to the previous party (stepOrder - 1).
// reviewCode B, C, or D is required (A means approved — not a valid return).

router.post(
  "/:id/return",
  requireMinRole("document_controller"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { reviewCode, comments } = req.body;

    if (!reviewCode) {
      res.status(400).json({ error: "reviewCode is required for return" });
      return;
    }
    if (reviewCode === "A") {
      res.status(400).json({
        error: "INVALID_REVIEW_CODE",
        message: "reviewCode 'A' (Approved) is not valid for a return. Use B, C, or D.",
      });
      return;
    }
    if (!["B", "C", "D"].includes(reviewCode)) {
      res.status(400).json({ error: "reviewCode must be B, C, or D for return" });
      return;
    }

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    if (chain.currentStatus !== "active") {
      res.status(409).json({
        error: "CHAIN_NOT_ACTIVE",
        message: `Chain is in status '${chain.currentStatus}'. Only active chains can be returned.`,
      });
      return;
    }

    if (chain.currentParticipantId === null) {
      res.status(400).json({
        error: "PARTIES_NOT_CONFIGURED",
        message: "Call setup-parties before using return.",
      });
      return;
    }

    const caller = req.user!;
    const callerParticipant = (!isSystemOwner(caller) && caller.organizationId)
      ? await resolveCallerParticipant(projectId, caller.organizationId)
      : null;

    if (!isSystemOwner(caller) && (!callerParticipant || callerParticipant.id !== chain.currentParticipantId)) {
      res.status(403).json({
        error: "Forbidden",
        message: "Only the current custodian can return this chain.",
      });
      return;
    }

    // Verify caller is not at stepOrder=1 (originator cannot return)
    const [currentParty] = await db
      .select({ stepOrder: submissionChainAllowedPartiesTable.stepOrder })
      .from(submissionChainAllowedPartiesTable)
      .where(
        and(
          eq(submissionChainAllowedPartiesTable.chainId, id),
          eq(submissionChainAllowedPartiesTable.participantId, chain.currentParticipantId),
        ),
      );

    if (!currentParty || currentParty.stepOrder <= 1) {
      res.status(400).json({
        error: "CANNOT_RETURN_FROM_ORIGINATOR",
        message: "The originating party (stepOrder 1) cannot return the chain.",
      });
      return;
    }

    // Find the previous party
    const [prevParty] = await db
      .select()
      .from(submissionChainAllowedPartiesTable)
      .where(
        and(
          eq(submissionChainAllowedPartiesTable.chainId, id),
          eq(submissionChainAllowedPartiesTable.stepOrder, currentParty.stepOrder - 1),
        ),
      );

    if (!prevParty?.participantId) {
      res.status(400).json({ error: "Previous party not found in allowed sequence" });
      return;
    }

    const fromOrgId = await resolveOrgFromParticipant(
      chain.currentParticipantId,
      caller.organizationId!,
    );
    const toOrgId = await resolveOrgFromParticipant(prevParty.participantId, caller.organizationId!);

    const allSteps = await db
      .select({ stepNumber: submissionChainStepsTable.stepNumber })
      .from(submissionChainStepsTable)
      .where(eq(submissionChainStepsTable.chainId, id));

    const [step] = await db
      .insert(submissionChainStepsTable)
      .values({
        chainId: id,
        stepNumber: allSteps.length + 1,
        revisionCycle: chain.activeRevisionCycle,
        action: "return",
        fromOrgId,
        toOrgId,
        fromParticipantId: chain.currentParticipantId,
        toParticipantId: prevParty.participantId,
        actionedById: caller.id,
        stepStatus: "actioned",
        reviewCode,
        comments: comments ?? null,
        reviewedById: caller.id,
        reviewedAt: new Date(),
      })
      .returning();

    const [updatedChain] = await db
      .update(submissionChainsTable)
      .set({
        currentStatus: "returned",
        currentOrgId: toOrgId,
        currentParticipantId: prevParty.participantId,
        currentStepStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    res.json({ chain: updatedChain, step });
  },
);

// ─── Resubmit chain ───────────────────────────────────────────────────────────
// The originating party (stepOrder=1) resubmits after a return, opening a
// new revision cycle and sending the chain back to stepOrder=2.

router.post(
  "/:id/resubmit",
  requireMinRole("document_controller"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { documentIds } = req.body as {
      documentIds?: Array<{ documentId: number; revisionId: number }>;
    };

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));

    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    if (chain.currentStatus !== "returned") {
      res.status(409).json({
        error: "CHAIN_NOT_RETURNED",
        message: `Chain must be in status 'returned' to resubmit. Current: '${chain.currentStatus}'.`,
      });
      return;
    }

    const caller = req.user!;
    const callerParticipant = caller.organizationId
      ? await resolveCallerParticipant(projectId, caller.organizationId)
      : null;

    const [originatorParty] = await db
      .select()
      .from(submissionChainAllowedPartiesTable)
      .where(
        and(
          eq(submissionChainAllowedPartiesTable.chainId, id),
          eq(submissionChainAllowedPartiesTable.stepOrder, 1),
        ),
      );

    if (
      !originatorParty?.participantId ||
      (!isSystemOwner(caller) && (!callerParticipant || callerParticipant.id !== originatorParty.participantId))
    ) {
      res.status(403).json({
        error: "Forbidden",
        message: "Only the originating party (stepOrder 1) can resubmit.",
      });
      return;
    }

    // Find the next party (stepOrder=2)
    const [nextParty] = await db
      .select()
      .from(submissionChainAllowedPartiesTable)
      .where(
        and(
          eq(submissionChainAllowedPartiesTable.chainId, id),
          eq(submissionChainAllowedPartiesTable.stepOrder, 2),
        ),
      );

    if (!nextParty?.participantId) {
      res.status(400).json({
        error: "No stepOrder=2 party configured. Call setup-parties first.",
      });
      return;
    }

    const newRevisionCycle = chain.activeRevisionCycle + 1;
    const fromOrgId = await resolveOrgFromParticipant(
      originatorParty.participantId,
      caller.organizationId!,
    );
    const toOrgId = await resolveOrgFromParticipant(nextParty.participantId, caller.organizationId!);

    const allSteps = await db
      .select({ stepNumber: submissionChainStepsTable.stepNumber })
      .from(submissionChainStepsTable)
      .where(eq(submissionChainStepsTable.chainId, id));

    const [step] = await db
      .insert(submissionChainStepsTable)
      .values({
        chainId: id,
        stepNumber: allSteps.length + 1,
        revisionCycle: newRevisionCycle,
        action: "forward",
        fromOrgId,
        toOrgId,
        fromParticipantId: originatorParty.participantId,
        toParticipantId: nextParty.participantId,
        actionedById: caller.id,
        stepStatus: "actioned",
      })
      .returning();

    if (documentIds && documentIds.length > 0) {
      await db.insert(submissionChainDocumentsTable).values(
        documentIds.map((d) => ({
          chainId: id,
          documentId: d.documentId,
          revisionId: d.revisionId,
          revisionCycle: newRevisionCycle,
          addedById: caller.id,
        })),
      );
    }

    const [updatedChain] = await db
      .update(submissionChainsTable)
      .set({
        activeRevisionCycle: newRevisionCycle,
        currentStatus: "active",
        currentOrgId: toOrgId,
        currentParticipantId: nextParty.participantId,
        currentStepStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    const documents = await db
      .select()
      .from(submissionChainDocumentsTable)
      .where(eq(submissionChainDocumentsTable.chainId, id));

    res.json({ chain: updatedChain, step, documents });
  },
);

export default router;
