import { Router } from "express";
import { db } from "@workspace/db";
import {
  transmittalsTable, transmittalItemsTable, transmittalHistoryTable,
  documentsTable, usersTable, projectsTable,
  tasksTable, projectMembersTable, notificationsTable,
  correspondenceTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword, isSysAdmin, hashToken } from "../lib/auth.js";
import { resolveEffectiveRole } from "../lib/governance.js";
import { TransmittalPermissions, checkAssignmentBasedPermission } from "../lib/permissions.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";
import type { Request, Response } from "express";
import { param, paramInt, paramIntOrNull, type ProjectParams, type ProjectItemParams } from '../lib/params';

const router = Router({ mergeParams: true });
router.use(requireAuth);

// List transmittals for a project
router.get("/", async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const transmittals = await db
    .select({
      id: transmittalsTable.id,
      transmittalNumber: transmittalsTable.transmittalNumber,
      subject: transmittalsTable.subject,
      description: transmittalsTable.description,
      status: transmittalsTable.status,
      purpose: transmittalsTable.purpose,
      direction: transmittalsTable.direction,
      partyType: transmittalsTable.partyType,
      reviewCode: transmittalsTable.reviewCode,
      dueDate: transmittalsTable.dueDate,
      sentAt: transmittalsTable.sentAt,
      acknowledgedAt: transmittalsTable.acknowledgedAt,
      createdAt: transmittalsTable.createdAt,
      createdByName: usersTable.firstName,
      toExternal: transmittalsTable.toExternal,
      projectId: transmittalsTable.projectId,
      approvalStatus: transmittalsTable.approvalStatus,
      approvedById: transmittalsTable.approvedById,
      approvalComment: transmittalsTable.approvalComment,
      approvedAt: transmittalsTable.approvedAt,
      reviewOutcome: transmittalsTable.reviewOutcome,
      responseToTransmittalId: transmittalsTable.responseToTransmittalId,
      responseTransmittalNumber: sql<string | null>`(
        SELECT t2.transmittal_number FROM transmittals t2
        WHERE t2.response_to_transmittal_id = ${transmittalsTable.id}
        LIMIT 1
      )`,
      sourceTransmittalNumber: sql<string | null>`(
        SELECT t2.transmittal_number FROM transmittals t2
        WHERE t2.id = ${transmittalsTable.responseToTransmittalId}
        LIMIT 1
      )`,
      itemCount: sql<number>`(
        SELECT COUNT(*) FROM transmittal_items
        WHERE transmittal_id = ${transmittalsTable.id}
      )::int`,
    })
    .from(transmittalsTable)
    .leftJoin(usersTable, eq(transmittalsTable.createdById, usersTable.id))
    .where(eq(transmittalsTable.projectId, projectId))
    .orderBy(desc(transmittalsTable.createdAt));
  res.json(transmittals);
});

// Get single transmittal with items
router.get("/:id", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const [transmittal] = await db
    .select()
    .from(transmittalsTable)
    .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));
  if (!transmittal) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: transmittalItemsTable.id,
      documentId: transmittalItemsTable.documentId,
      revision: transmittalItemsTable.revision,
      copies: transmittalItemsTable.copies,
      purpose: transmittalItemsTable.purpose,
      reviewCode: transmittalItemsTable.reviewCode,
      documentNumber: documentsTable.documentNumber,
      documentTitle: documentsTable.title,
      documentType: documentsTable.documentType,
      discipline: documentsTable.discipline,
      documentStatus: documentsTable.status,
    })
    .from(transmittalItemsTable)
    .leftJoin(documentsTable, eq(transmittalItemsTable.documentId, documentsTable.id))
    .where(eq(transmittalItemsTable.transmittalId, id));

  // Linked transmittal numbers
  let sourceTransmittalNumber: string | null = null;
  let responseTransmittalNumber: string | null = null;
  let responseTransmittalId: number | null = null;

  if (transmittal.responseToTransmittalId) {
    const [src] = await db
      .select({ transmittalNumber: transmittalsTable.transmittalNumber })
      .from(transmittalsTable)
      .where(eq(transmittalsTable.id, transmittal.responseToTransmittalId));
    sourceTransmittalNumber = src?.transmittalNumber ?? null;
  }

  const [resp] = await db
    .select({ transmittalNumber: transmittalsTable.transmittalNumber, id: transmittalsTable.id })
    .from(transmittalsTable)
    .where(eq(transmittalsTable.responseToTransmittalId, id));
  if (resp) {
    responseTransmittalNumber = resp.transmittalNumber;
    responseTransmittalId = resp.id;
  }

  res.json({ ...transmittal, items, sourceTransmittalNumber, responseTransmittalNumber, responseTransmittalId });
});

// Create transmittal
router.post("/", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const { subject, description, purpose, dueDate, toExternal, externalEmails, ccEmails, documentIds, direction, partyType, reviewCode } = req.body;
  if (!subject) { res.status(400).json({ error: "Subject is required" }); return; }

  // Generate transmittal number
  const existing = await db
    .select({ count: transmittalsTable.id })
    .from(transmittalsTable)
    .where(eq(transmittalsTable.projectId, projectId));
  const seq = String(existing.length + 1).padStart(4, "0");
  const [project] = await db.select({ code: projectsTable.code }).from(projectsTable).where(eq(projectsTable.id, projectId));
  const transmittalNumber = `TRS-${project?.code ?? "PRJ"}-${seq}`;

  let initialStatus: "draft" | "sent" | "acknowledged" | "rejected" = "draft";
  if (reviewCode === "A" || reviewCode === "B") initialStatus = "acknowledged";
  else if (reviewCode === "D") initialStatus = "rejected";

  const [transmittal] = await db.insert(transmittalsTable).values({
    transmittalNumber,
    subject,
    description,
    purpose: purpose || "for_information",
    dueDate: dueDate ? new Date(dueDate) : undefined,
    toExternal,
    externalEmails: externalEmails ?? null,
    ccEmails: ccEmails ?? null,
    organizationId: req.user!.organizationId ?? null,
    projectId,
    createdById: req.user!.id,
    direction: direction ?? null,
    partyType: partyType ?? null,
    reviewCode: reviewCode ?? null,
    status: initialStatus,
  }).returning();

  // Add documents
  if (documentIds?.length) {
    await db.insert(transmittalItemsTable).values(
      documentIds.map((docId: number) => ({
        transmittalId: transmittal.id,
        documentId: docId,
      }))
    );
  }

  // Log creation history
  const actor = req.user as any;
  const actorName = `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || "System";
  await db.insert(transmittalHistoryTable).values({
    transmittalId: transmittal.id,
    eventType: "created",
    description: `Transmittal created${direction ? ` (${direction})` : ""}${partyType ? ` for ${partyType}` : ""}`,
    performedByName: actorName,
  });

  await createAuditLog({
    userId: req.user!.id,
    action: "create",
    entityType: "transmittal",
    entityId: transmittal.id,
    details: { transmittalNumber },
  });

  res.status(201).json(transmittal);
});

// Update transmittal
router.put("/:id", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const { subject, description, purpose, dueDate, toExternal, externalEmails, ccEmails, status, direction, partyType, reviewCode } = req.body;

  const [existing] = await db.select().from(transmittalsTable)
    .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));

  let resolvedStatus = status;
  const reviewCodeChanged = reviewCode !== undefined && reviewCode !== existing?.reviewCode;
  if (reviewCode !== undefined) {
    if (reviewCode === "A" || reviewCode === "B") resolvedStatus = "acknowledged";
    else if (reviewCode === "C") resolvedStatus = "sent";
    else if (reviewCode === "D") resolvedStatus = "rejected";
  }

  const [transmittal] = await db.update(transmittalsTable)
    .set({ subject, description, purpose, dueDate: dueDate ? new Date(dueDate) : undefined, toExternal, externalEmails: externalEmails ?? undefined, ccEmails: ccEmails ?? undefined, status: resolvedStatus, direction, partyType, reviewCode, updatedAt: new Date() })
    .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)))
    .returning();

  if (reviewCodeChanged && reviewCode) {
    const actor = req.user as any;
    const actorName = `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || "System";
    const codeLabels: Record<string, string> = { A: "Approved", B: "Approved with Comments", C: "Revise and Resubmit", D: "Rejected" };
    await db.insert(transmittalHistoryTable).values({
      transmittalId: id,
      eventType: "review_code_set",
      description: `Review code set to ${reviewCode} — ${codeLabels[reviewCode] ?? reviewCode}`,
      performedByName: actorName,
    });
  }

  res.json(transmittal);
});

// Send transmittal
router.post("/:id/send", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const [transmittal] = await db.update(transmittalsTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id))
    .returning();
  const actor = req.user as any;
  const actorName = `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || "System";
  await db.insert(transmittalHistoryTable).values({
    transmittalId: id,
    eventType: "sent",
    description: `Transmittal sent${transmittal?.toExternal ? ` to ${transmittal.toExternal}` : ""}`,
    performedByName: actorName,
  });
  await createAuditLog({
    userId: req.user!.id, action: "update", entityType: "transmittal",
    entityId: id, details: { action: "sent" },
  });

  // Auto-create review task when purpose is "for_review"
  if (transmittal?.purpose === "for_review" && transmittal.projectId) {
    try {
      const dueDate = transmittal.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      // Find the project manager for this project
      const [pm] = await db
        .select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, transmittal.projectId), eq(projectMembersTable.role, "project_manager")))
        .limit(1);
      const autoAssignee = pm?.userId ?? req.user!.id;
      const [task] = await db.insert(tasksTable).values({
        title: `Review transmittal: ${transmittal.transmittalNumber}`,
        description: transmittal.subject ?? undefined,
        priority: "high",
        status: "pending",
        projectId: transmittal.projectId,
        createdById: req.user!.id,
        assignedToId: autoAssignee,
        dueDate,
      }).returning();
      // Notify assignee if different from sender
      if (autoAssignee !== req.user!.id) {
        await db.insert(notificationsTable).values({
          userId: autoAssignee,
          type: "task_assigned",
          title: "Review task assigned",
          message: `Please review transmittal ${transmittal.transmittalNumber}: ${transmittal.subject}`,
          projectId: transmittal.projectId,
          entityType: "task",
          entityId: task.id,
          actionUrl: `/tasks`,
        });
      }
    } catch (e) {
      // never block send response
    }
  }

  res.json(transmittal);
});

// Acknowledge transmittal
router.post("/:id/acknowledge", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const [transmittal] = await db.update(transmittalsTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id))
    .returning();
  const actor = (req as any).user as any;
  const actorName = actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || "External" : "External";
  await db.insert(transmittalHistoryTable).values({
    transmittalId: id,
    eventType: "acknowledged",
    description: "Transmittal acknowledged by recipient",
    performedByName: actorName,
  });
  res.json(transmittal);
});

// Complete review — compute rolled-up outcome, apply document statuses, create response draft
router.post("/:id/complete-review", requireAuth, async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const actor = req.user as any;
  const actorName = `${actor?.firstName ?? ""} ${actor?.lastName ?? ""}`.trim() || "System";
  const { reviewComment } = req.body;

  const [transmittal] = await db.select().from(transmittalsTable)
    .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));
  if (!transmittal) { res.status(404).json({ error: "Not found" }); return; }

  // Check no response already exists
  const [existingResponse] = await db.select({ id: transmittalsTable.id })
    .from(transmittalsTable).where(eq(transmittalsTable.responseToTransmittalId, id));
  if (existingResponse) {
    res.status(409).json({ error: "A response transmittal already exists for this transmittal" });
    return;
  }

  // Fetch items
  const items = await db.select({
    id: transmittalItemsTable.id,
    documentId: transmittalItemsTable.documentId,
    reviewCode: transmittalItemsTable.reviewCode,
  }).from(transmittalItemsTable).where(eq(transmittalItemsTable.transmittalId, id));

  if (items.length === 0) { res.status(400).json({ error: "No items on this transmittal" }); return; }

  const unreviewed = items.filter(i => !i.reviewCode);
  if (unreviewed.length > 0) {
    res.status(400).json({ error: `${unreviewed.length} item(s) still need a review code` });
    return;
  }

  // Compute rolled-up outcome: D > C > B > A
  const codePriority: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };
  const worstCode = items.reduce((worst: string, item) => {
    const code = item.reviewCode ?? "A";
    return (codePriority[code] ?? 0) > (codePriority[worst] ?? 0) ? code : worst;
  }, "A");

  const outcomeLabels: Record<string, string> = {
    A: "Approved",
    B: "Approved with Comments",
    C: "Revise and Resubmit",
    D: "Rejected",
  };

  const REVIEW_CODE_TO_DECISION: Record<string, ReviewDecision> = {
    A: "approved",
    B: "approved_with_comments",
    C: "for_revision",
    D: "rejected",
  };

  // Apply document status decisions for each item
  await Promise.all(
    items
      .filter(i => i.reviewCode && REVIEW_CODE_TO_DECISION[i.reviewCode])
      .map(i =>
        applyDocumentReviewDecision({
          documentId: i.documentId,
          decision: REVIEW_CODE_TO_DECISION[i.reviewCode!],
          reviewerId: actor.id,
          reviewerName: actorName,
          comment: reviewComment
            ? `${actorName}: ${reviewComment}`
            : `Auto-updated from transmittal ${transmittal.transmittalNumber} — review code ${i.reviewCode} (${outcomeLabels[i.reviewCode!] ?? i.reviewCode})`,
        })
      )
  );

  // Update the transmittal with the review outcome
  await db.update(transmittalsTable)
    .set({ reviewOutcome: worstCode, status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id));

  const historyDesc = reviewComment
    ? `Review completed — overall outcome: ${worstCode} (${outcomeLabels[worstCode] ?? worstCode}). Reviewer notes: ${reviewComment}`
    : `Review completed — overall outcome: ${worstCode} (${outcomeLabels[worstCode] ?? worstCode})`;

  await db.insert(transmittalHistoryTable).values({
    transmittalId: id,
    eventType: "review_completed",
    description: historyDesc,
    performedByName: actorName,
  });

  // Generate response transmittal number
  const existing = await db
    .select({ count: transmittalsTable.id })
    .from(transmittalsTable)
    .where(eq(transmittalsTable.projectId, projectId));
  const seq = String(existing.length + 1).padStart(4, "0");
  const [project] = await db.select({ code: projectsTable.code })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  const responseNumber = `TRS-${project?.code ?? "PRJ"}-${seq}`;

  // Build response description — include resubmission instruction for C/D
  const needsResubmission = worstCode === "C" || worstCode === "D";
  const responseDesc = [
    `Response to ${transmittal.transmittalNumber}.`,
    `Overall review outcome: ${worstCode} — ${outcomeLabels[worstCode] ?? worstCode}.`,
    reviewComment ? `Reviewer notes: ${reviewComment}` : null,
    needsResubmission
      ? "ACTION REQUIRED: One or more documents require revision and resubmission. Please attach the revised documents and re-send this transmittal."
      : null,
  ].filter(Boolean).join(" ");

  const [response] = await db.insert(transmittalsTable).values({
    transmittalNumber: responseNumber,
    subject: `Re: ${transmittal.subject}`,
    description: responseDesc,
    purpose: transmittal.purpose,
    organizationId: transmittal.organizationId,
    projectId,
    createdById: actor.id,
    toExternal: transmittal.toExternal ?? undefined,
    externalEmails: transmittal.externalEmails ?? undefined,
    ccEmails: transmittal.ccEmails ?? undefined,
    direction: "outgoing",
    status: "draft",
    responseToTransmittalId: id,
  }).returning();

  // Copy item document IDs (with codes) to the response transmittal
  if (items.length > 0) {
    await db.insert(transmittalItemsTable).values(
      items.map(i => ({
        transmittalId: response.id,
        documentId: i.documentId,
        reviewCode: i.reviewCode ?? undefined,
      }))
    );
  }

  await db.insert(transmittalHistoryTable).values({
    transmittalId: response.id,
    eventType: "created",
    description: `Response transmittal created automatically from review of ${transmittal.transmittalNumber}`,
    performedByName: actorName,
  });

  await createAuditLog({
    userId: actor.id,
    action: "review_completed",
    entityType: "transmittal",
    entityId: id,
    details: { outcome: worstCode, responseTrsNumber: responseNumber, comment: reviewComment ?? null },
  });

  res.json({ reviewOutcome: worstCode, responseTrs: response });
});

// Get transmittal history
router.get("/:id/history", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const rows = await db.select().from(transmittalHistoryTable)
    .where(eq(transmittalHistoryTable.transmittalId, id))
    .orderBy(desc(transmittalHistoryTable.createdAt));
  res.json({ history: rows });
});

// ─── AI-assisted suggest-links ────────────────────────────────────────────────
// Pure lexical scoring — no LLM call needed; fast and free.
const STOPWORDS = new Set([
  "a","an","the","and","or","of","in","to","for","with","on","at","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","that","this",
  "these","those","it","its","re","submission","transmittal","letter","regarding",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    (text ?? "").toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

router.get("/:id/suggest-links", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const transmittalId = paramInt(req.params.id);

  const [transmittal] = await db.select().from(transmittalsTable).where(eq(transmittalsTable.id, transmittalId));
  if (!transmittal) { res.status(404).json({ error: "Not found" }); return; }

  const queryText = `${transmittal.subject ?? ""} ${transmittal.description ?? ""}`;
  const queryTokens = tokenize(queryText);

  // Already-linked document IDs (exclude from suggestions)
  const linkedItems = await db.select({ documentId: transmittalItemsTable.documentId })
    .from(transmittalItemsTable)
    .where(eq(transmittalItemsTable.transmittalId, transmittalId));
  const linkedDocIds = new Set(linkedItems.map(i => i.documentId));

  // Candidate documents
  const docs = await db.select({
    id: documentsTable.id,
    documentNumber: documentsTable.documentNumber,
    title: documentsTable.title,
    description: documentsTable.description,
    status: documentsTable.status,
    revision: documentsTable.revision,
    documentType: documentsTable.documentType,
  }).from(documentsTable).where(eq(documentsTable.projectId, projectId));

  const docSuggestions = docs
    .filter(d => !linkedDocIds.has(d.id))
    .map(d => ({
      ...d,
      score: jaccardScore(queryTokens, tokenize(`${d.title} ${d.description ?? ""} ${d.documentNumber}`)),
    }))
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Candidate correspondence
  const corrRows = await db.select({
    id: correspondenceTable.id,
    referenceNumber: correspondenceTable.referenceNumber,
    subject: correspondenceTable.subject,
    status: correspondenceTable.status,
    createdAt: correspondenceTable.createdAt,
    direction: correspondenceTable.direction,
  }).from(correspondenceTable).where(eq(correspondenceTable.projectId, projectId));

  const corrSuggestions = corrRows
    .map(c => ({
      ...c,
      score: jaccardScore(queryTokens, tokenize(`${c.subject} ${c.referenceNumber ?? ""}`)),
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  res.json({ documents: docSuggestions, correspondence: corrSuggestions, queryTokens: [...queryTokens] });
});

// Add document to transmittal
router.post("/:id/items", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const transmittalId = paramInt(req.params.id);
  const { documentId, revision, copies, purpose } = req.body;
  const [item] = await db.insert(transmittalItemsTable).values({
    transmittalId, documentId, revision, copies, purpose,
  }).returning();
  res.status(201).json(item);
});

// Remove document from transmittal
router.delete("/:id/items/:itemId", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams & { itemId: string }>, res): Promise<void> => {
  const itemId = paramInt(req.params.itemId);
  await db.delete(transmittalItemsTable).where(eq(transmittalItemsTable.id, itemId));
  res.json({ success: true });
});

// Set per-item review code — assignment-based: must be the designated recipient or admin+
router.patch("/:id/items/:itemId", requireAuth, async (req: Request<ProjectItemParams & { itemId: string }>, res): Promise<void> => {
  const transmittalId = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const itemId = paramInt(req.params.itemId);
  const caller = req.user!;
  const { reviewCode } = req.body;

  // Fetch transmittal to check assignment
  const [transmittal] = await db.select({
    toUserId: transmittalsTable.toUserId,
    createdById: transmittalsTable.createdById,
  }).from(transmittalsTable)
    .where(and(eq(transmittalsTable.id, transmittalId), eq(transmittalsTable.projectId, projectId)))
    .limit(1);
  if (!transmittal) { res.status(404).json({ error: "Transmittal not found" }); return; }

  const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId);

  // Assignment check: caller is the designated recipient, or admin+ override
  const isAssigned = transmittal.toUserId === caller.id || transmittal.createdById === caller.id;
  const basis = checkAssignmentBasedPermission(effectiveRole, isAssigned, "reviewer");
  if (!basis) {
    res.status(403).json({ error: "Forbidden", message: "You must be the designated recipient to set review codes, or an admin to override" }); return;
  }

  if (basis === "admin_override") {
    await createAuditLog({
      userId: caller.id, organizationId: caller.organizationId,
      action: "admin_override_review_code", entityType: "transmittal_item",
      entityId: itemId, projectId, details: { reviewCode, transmittalId },
    });
  }

  const [updated] = await db.update(transmittalItemsTable)
    .set({ reviewCode: reviewCode ?? null })
    .where(eq(transmittalItemsTable.id, itemId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(updated);
});

// Create / update share link
router.post("/:id/share", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const { expiresInDays, password } = req.body;

  // Verify the project belongs to the caller's org — prevents cross-tenant share creation
  // even when the transmittal's own organizationId is NULL (legacy unseeded data).
  const [project] = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, req.user!.organizationId!)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Not found" }); return; }

  const token = crypto.randomBytes(32).toString("hex");
  const days = Math.min(Math.max(parseInt(expiresInDays) || 30, 1), 90);
  const expiresAt = new Date(Date.now() + days * 86400000);
  const passwordHash = password ? await hashPassword(password) : null;

  const [transmittal] = await db.update(transmittalsTable)
    .set({
      shareToken: hashToken(token),
      shareExpiresAt: expiresAt,
      sharePasswordHash: passwordHash ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)))
    .returning({ id: transmittalsTable.id, shareExpiresAt: transmittalsTable.shareExpiresAt });

  if (!transmittal) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "share", entityType: "transmittal",
    entityId: id, details: { expiresInDays: days, passwordProtected: !!password },
  });

  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({
    shareUrl: `${baseUrl}/shared/transmittal/${token}`,
    shareToken: token,
    expiresAt,
  });
});

// Upload external file and add as transmittal attachment (creates a stub doc)
router.post("/:id/upload-attachment", async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const transmittalId = paramInt(req.params.id);
  const { fileName, fileUrl, fileSize } = req.body;
  if (!fileName || !fileUrl) { res.status(400).json({ error: "fileName and fileUrl required" }); return; }

  // Create a stub document record for the external file
  const [doc] = await db.insert(documentsTable).values({
    documentNumber: `EXT-${Date.now().toString().slice(-6)}`,
    title: fileName,
    documentType: "external",
    revision: "1",
    status: "issued",
    projectId,
    createdById: (req as any).user!.id,
    fileUrl,
    fileName,
    fileSize: fileSize ?? 0,
  }).returning();

  // Add as transmittal item
  const [item] = await db.insert(transmittalItemsTable).values({
    transmittalId,
    documentId: doc.id,
    purpose: "external_attachment",
  }).returning();

  res.status(201).json({ ...item, documentTitle: doc.title, documentNumber: doc.documentNumber, documentType: doc.documentType });
});

// Revoke share link
router.delete("/:id/share", requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectItemParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  await db.update(transmittalsTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id));
  res.json({ success: true });
});

// ─── Workflow Approval ────────────────────────────────────────────────────────
router.post(
  "/:id/submit-approval",
  requireRole("admin", "project_manager", "document_controller"),
  async (req: Request<ProjectItemParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
    const [existing] = await db.select().from(transmittalsTable)
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db.update(transmittalsTable)
      .set({ approvalStatus: "pending", approvedById: null, approvalComment: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)))
      .returning();
    await createAuditLog({
      userId: req.user!.id, action: "approval_submitted", entityType: "transmittal",
      entityId: id, entityTitle: row.transmittalNumber, projectId: row.projectId,
    });
    res.json(row);
  }
);

router.post(
  "/:id/approve",
  requireAuth,
  async (req: Request<ProjectItemParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
    const caller = req.user!;
    const { comment, decision: rawDecision } = req.body;

    // Direct transmittal approval is an admin-override action only
    const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId);
    if (!isSysAdmin(caller) && effectiveRole !== "admin") {
      res.status(403).json({ error: "Forbidden", message: "Direct transmittal approval is an admin override. Normal approvals go through the workflow engine." }); return;
    }
    if (!comment?.trim()) {
      res.status(400).json({ error: "A comment is required for admin override approvals" }); return;
    }

    const decision: ReviewDecision = isValidReviewDecision(rawDecision) ? rawDecision : "approved";

    const [existing] = await db.select().from(transmittalsTable)
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to approve" }); return; }

    const [row] = await db.update(transmittalsTable)
      .set({
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)))
      .returning();

    if (existing.purpose === "for_review") {
      const items = await db.select({ documentId: transmittalItemsTable.documentId })
        .from(transmittalItemsTable)
        .where(eq(transmittalItemsTable.transmittalId, id));

      if (items.length > 0) {
        const reviewer = req.user as any;
        const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;
        await Promise.all(items.map(item =>
          applyDocumentReviewDecision({
            documentId: item.documentId,
            decision,
            reviewerId: req.user!.id,
            reviewerName,
            comment,
          })
        ));
      }
    }

    // Auto-update linked document statuses for incoming transmittals based on per-item reviewCode
    const PROTECTED_DOC_STATUSES = new Set(["issued", "superseded", "void"]);
    const REVIEW_CODE_TO_STATUS: Record<string, ReviewDecision> = {
      A: "approved",
      B: "approved_with_comments",
      C: "for_revision",
      D: "rejected",
    };

    if ((existing.direction ?? "").toUpperCase() === "IN") {
      const items = await db
        .select({
          documentId: transmittalItemsTable.documentId,
          reviewCode: transmittalItemsTable.reviewCode,
          currentStatus: documentsTable.status,
        })
        .from(transmittalItemsTable)
        .leftJoin(documentsTable, eq(transmittalItemsTable.documentId, documentsTable.id))
        .where(eq(transmittalItemsTable.transmittalId, id));

      const reviewer = req.user as any;
      const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;

      await Promise.all(
        items
          .filter(item => {
            if (!item.reviewCode) return false;
            if (!REVIEW_CODE_TO_STATUS[item.reviewCode]) return false;
            if (PROTECTED_DOC_STATUSES.has(item.currentStatus ?? "")) return false;
            return true;
          })
          .map(item =>
            applyDocumentReviewDecision({
              documentId: item.documentId,
              decision: REVIEW_CODE_TO_STATUS[item.reviewCode!],
              reviewerId: req.user!.id,
              reviewerName,
              comment: `Auto-updated from transmittal ${row.transmittalNumber} (review code ${item.reviewCode})`,
            })
          )
      );
    }

    await createAuditLog({
      userId: req.user!.id, action: "record_approved", entityType: "transmittal",
      entityId: id, entityTitle: row.transmittalNumber, projectId: row.projectId,
      details: { comment, decision },
    });
    res.json(row);
  }
);

router.post(
  "/:id/reject",
  requireAuth,
  async (req: Request<ProjectItemParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
    const caller = req.user!;
    const { comment, decision: rawDecision } = req.body;

    // Direct transmittal rejection is an admin-override action only; comment is mandatory
    const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId);
    if (!isSysAdmin(caller) && effectiveRole !== "admin") {
      res.status(403).json({ error: "Forbidden", message: "Direct transmittal rejection is an admin override. Normal rejections go through the workflow engine." }); return;
    }
    if (!comment?.trim()) {
      res.status(400).json({ error: "A comment is required for admin override rejections" }); return;
    }

    const decision: ReviewDecision =
      (rawDecision === "rejected" || rawDecision === "for_revision") ? rawDecision : "for_revision";

    const [existing] = await db.select().from(transmittalsTable)
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to reject" }); return; }

    const [row] = await db.update(transmittalsTable)
      .set({
        approvalStatus: "rejected",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(transmittalsTable.id, id), eq(transmittalsTable.projectId, projectId)))
      .returning();

    if (existing.purpose === "for_review") {
      const items = await db.select({ documentId: transmittalItemsTable.documentId })
        .from(transmittalItemsTable)
        .where(eq(transmittalItemsTable.transmittalId, id));

      if (items.length > 0) {
        const reviewer = req.user as any;
        const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;
        await Promise.all(items.map(item =>
          applyDocumentReviewDecision({
            documentId: item.documentId,
            decision,
            reviewerId: req.user!.id,
            reviewerName,
            comment,
          })
        ));
      }
    }

    await createAuditLog({
      userId: req.user!.id, action: "record_rejected", entityType: "transmittal",
      entityId: id, entityTitle: row.transmittalNumber, projectId: row.projectId,
      details: { comment, decision },
    });
    res.json(row);
  }
);

expor