import { Router } from "express";
import { db } from "@workspace/db";
import {
  submissionChainsTable,
  submissionChainStepsTable,
  submissionChainDocumentsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAuth, requireRole, isSystemOwner } from "../lib/auth.js";
import { requireInt } from "../lib/params.js";
import type { Request, Response } from "express";
import type { ProjectParams, ProjectItemParams } from "../lib/params.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// List chains visible to caller's org (originating or current custodian)
router.get("/", async (req: Request<ProjectParams>, res: Response): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const caller = req.user!;
  const chains = await db
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
  res.json(chains);
});

// Create a new submission chain and optionally attach documents (revisionCycle=1)
router.post(
  "/",
  requireRole("admin", "project_manager", "document_controller"),
  async (req: Request<ProjectParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const { title, description, documentIds } = req.body;
    if (!title) { res.status(400).json({ error: "Title is required" }); return; }
    if (!req.user!.organizationId) { res.status(400).json({ error: "User must belong to an organisation" }); return; }

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

// Get chain with full steps + documents. Access: originatingOrg, currentOrg, orgs in steps, system_owner.
router.get("/:id", async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const id = requireInt(req.params.id);
  const caller = req.user!;

  const [chain] = await db
    .select()
    .from(submissionChainsTable)
    .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));
  if (!chain) { res.status(404).json({ error: "Not found" }); return; }

  if (
    !isSystemOwner(caller) &&
    chain.originatingOrgId !== caller.organizationId &&
    chain.currentOrgId !== caller.organizationId
  ) {
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
    if (!inStep) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const steps = await db
    .select()
    .from(submissionChainStepsTable)
    .where(eq(submissionChainStepsTable.chainId, id))
    .orderBy(submissionChainStepsTable.stepNumber);

  const documents = await db
    .select()
    .from(submissionChainDocumentsTable)
    .where(eq(submissionChainDocumentsTable.chainId, id));

  res.json({ ...chain, steps, documents });
});

// Forward chain custody to another org. Only the current custodian may forward.
// Records an immutable step in the audit trail; never mutates currentOrgId silently.
router.post(
  "/:id/forward",
  requireRole("admin", "project_manager", "document_controller"),
  async (req: Request<ProjectItemParams>, res: Response): Promise<void> => {
    const projectId = requireInt(req.params.projectId);
    const id = requireInt(req.params.id);
    const { toOrgId, assignedToUserId, transmittalId } = req.body;
    if (!toOrgId) { res.status(400).json({ error: "toOrgId is required" }); return; }

    const [chain] = await db
      .select()
      .from(submissionChainsTable)
      .where(and(eq(submissionChainsTable.id, id), eq(submissionChainsTable.projectId, projectId)));
    if (!chain) { res.status(404).json({ error: "Not found" }); return; }

    if (chain.currentOrgId !== req.user!.organizationId) {
      res.status(403).json({
        error: "Forbidden",
        message: "Only the current custodian organisation can forward this chain",
        currentCustodianOrgId: chain.currentOrgId,
      });
      return;
    }

    const allSteps = await db
      .select({ stepNumber: submissionChainStepsTable.stepNumber })
      .from(submissionChainStepsTable)
      .where(eq(submissionChainStepsTable.chainId, id));
    const nextStep = allSteps.length + 1;

    const [step] = await db
      .insert(submissionChainStepsTable)
      .values({
        chainId: id,
        stepNumber: nextStep,
        revisionCycle: chain.activeRevisionCycle,
        action: "forward",
        fromOrgId: chain.currentOrgId,
        toOrgId,
        actionedById: req.user!.id,
        stepStatus: "actioned",
        assignedToUserId: assignedToUserId ?? null,
        transmittalId: transmittalId ?? null,
      })
      .returning();

    const [updatedChain] = await db
      .update(submissionChainsTable)
      .set({ currentOrgId: toOrgId, currentStepStartedAt: new Date(), updatedAt: new Date() })
      .where(eq(submissionChainsTable.id, id))
      .returning();

    res.json({ chain: updatedChain, step });
  },
);

export default router;
