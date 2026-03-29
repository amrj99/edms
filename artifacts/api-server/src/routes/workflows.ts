import { Router } from "express";
import { db } from "@workspace/db";
import { workflowsTable, workflowStepsTable, documentsTable, usersTable, documentRevisionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { applyDocumentReviewDecision, isValidReviewDecision, consolidateDecisions, type ReviewDecision } from "../lib/document-review.js";

const router = Router({ mergeParams: true });

async function enrichWorkflows(workflows: (typeof workflowsTable.$inferSelect)[]) {
  if (!workflows.length) return [];
  const docIds = [...new Set(workflows.map(w => w.documentId))];
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, docIds[0]));
  const docMap = new Map(docs.map(d => [d.id, d]));

  const userIds = [...new Set(workflows.map(w => w.initiatedById))];
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));

  const steps = await db.select({
    step: workflowStepsTable,
    user: usersTable,
  }).from(workflowStepsTable)
    .leftJoin(usersTable, eq(workflowStepsTable.userId, usersTable.id))
    .orderBy(desc(workflowStepsTable.createdAt));

  const stepMap = new Map<number, typeof steps>();
  for (const s of steps) {
    if (!stepMap.has(s.step.workflowId)) stepMap.set(s.step.workflowId, []);
    stepMap.get(s.step.workflowId)!.push(s);
  }

  return workflows.map(w => {
    const doc = docMap.get(w.documentId);
    const initiatedBy = userMap.get(w.initiatedById);
    const wSteps = (stepMap.get(w.id) || []).map(({ step, user }) => ({
      id: step.id,
      step: step.step,
      action: step.action,
      comment: step.comment,
      userId: step.userId,
      userName: user ? `${user.firstName} ${user.lastName}` : undefined,
      createdAt: step.createdAt,
    }));

    return {
      ...w,
      documentTitle: doc?.title,
      documentNumber: doc?.documentNumber,
      initiatedByName: initiatedBy ? `${initiatedBy.firstName} ${initiatedBy.lastName}` : undefined,
      steps: wSteps,
    };
  });
}

router.get("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { status } = req.query;

  let workflows = await db.select().from(workflowsTable)
    .where(eq(workflowsTable.projectId, projectId))
    .orderBy(desc(workflowsTable.updatedAt));

  if (status) workflows = workflows.filter(w => w.status === status);

  const enriched = await enrichWorkflows(workflows);
  res.json({ workflows: enriched, total: enriched.length });
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);

  const workflows = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.projectId, projectId)))
    .limit(1);

  if (!workflows[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichWorkflows(workflows);
  res.json(enriched[0]);
});

router.post("/:id/action", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { action, comment, decision: rawDecision } = req.body;

  const workflows = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.projectId, projectId)))
    .limit(1);

  if (!workflows[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const workflow = workflows[0];

  const reviewer = req.user as any;
  const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;

  let newStep = workflow.currentStep;
  let newStatus = workflow.status;
  let stepAction: string = "commented";

  if (action === "approve") {
    const decision: ReviewDecision = isValidReviewDecision(rawDecision) ? rawDecision : "approved";
    stepAction = decision;

    if (decision === "approved") {
      if (workflow.currentStep === "under_review") newStep = "approved";
      else if (workflow.currentStep === "approved") newStep = "issued";
      if (newStep === "issued") newStatus = "completed";
    } else {
      newStep = "under_review";
    }

    const appliedDecision = (newStep === "issued") ? "approved" : decision;
    const docStatus = (newStep === "issued") ? "issued" : decision;
    await db.update(documentsTable)
      .set({ status: docStatus as any, updatedAt: new Date() })
      .where(eq(documentsTable.id, workflow.documentId));

    const [docRow] = await db.select({ revision: documentsTable.revision })
      .from(documentsTable).where(eq(documentsTable.id, workflow.documentId)).limit(1);
    await db.insert(documentRevisionsTable).values({
      documentId: workflow.documentId,
      revision: docRow?.revision ?? "A",
      status: docStatus,
      comment: comment ?? `${appliedDecision.replace(/_/g, " ")} by ${reviewerName}`,
      createdById: req.user!.id,
      reviewDecision: appliedDecision,
      reviewerName,
    });

  } else if (action === "reject") {
    const decision: ReviewDecision =
      (rawDecision === "rejected" || rawDecision === "for_revision") ? rawDecision : "for_revision";
    newStep = "rejected";
    newStatus = "rejected";
    stepAction = decision;

    await applyDocumentReviewDecision({
      documentId: workflow.documentId,
      decision,
      reviewerId: req.user!.id,
      reviewerName,
      comment,
    });
  }

  const [updated] = await db.update(workflowsTable)
    .set({ currentStep: newStep, status: newStatus, updatedAt: new Date() })
    .where(eq(workflowsTable.id, id))
    .returning();

  await db.insert(workflowStepsTable).values({
    workflowId: id,
    step: newStep,
    action: stepAction as any,
    comment,
    userId: req.user!.id,
  });

  await createAuditLog({
    userId: req.user!.id, action: `workflow_${action}`, entityType: "workflow",
    entityId: id, projectId, details: { decision: rawDecision },
  });

  const enriched = await enrichWorkflows([updated]);
  res.json(enriched[0]);
});

export default router;
