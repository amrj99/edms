import { Router } from "express";
import { db } from "@workspace/db";
import {
  transmittalsTable, transmittalItemsTable, transmittalHistoryTable,
  documentsTable, usersTable, projectsTable,
  tasksTable, projectMembersTable, notificationsTable,
  correspondenceTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";
import type { Request, Response } from "express";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// List transmittals for a project
router.get("/", async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const projectId = parseInt(req.params.projectId);
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

  res.json({ ...transmittal, items });
});

// Create transmittal
router.post("/", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { subject, description, purpose, dueDate, toExternal, documentIds, direction, partyType, reviewCode } = req.body;
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
router.put("/:id", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const projectId = parseInt(req.params.projectId);
  const { subject, description, purpose, dueDate, toExternal, status, direction, partyType, reviewCode } = req.body;

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
    .set({ subject, description, purpose, dueDate: dueDate ? new Date(dueDate) : undefined, toExternal, status: resolvedStatus, direction, partyType, reviewCode, updatedAt: new Date() })
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
router.post("/:id/send", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
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
      const assigneeId = pm?.userId ?? req.user!.id;
      const [task] = await db.insert(tasksTable).values({
        title: `Review transmittal: ${transmittal.transmittalNumber}`,
        description: transmittal.subject ?? undefined,
        priority: "high",
        status: "pending",
        projectId: transmittal.projectId,
        createdById: req.user!.id,
        assigneeId,
        dueDate,
      }).returning();
      // Notify assignee if different from sender
      if (assigneeId !== req.user!.id) {
        await db.insert(notificationsTable).values({
          userId: assigneeId,
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
router.post("/:id/acknowledge", async (req, res) => {
  const id = parseInt(req.params.id);
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

// Get transmittal history
router.get("/:id/history", async (req, res) => {
  const id = parseInt(req.params.id);
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

router.get("/:id/suggest-links", async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const transmittalId = parseInt(req.params.id);

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
router.post("/:id/items", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const transmittalId = parseInt(req.params.id);
  const { documentId, revision, copies, purpose } = req.body;
  const [item] = await db.insert(transmittalItemsTable).values({
    transmittalId, documentId, revision, copies, purpose,
  }).returning();
  res.status(201).json(item);
});

// Remove document from transmittal
router.delete("/:id/items/:itemId", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const itemId = parseInt(req.params.itemId);
  await db.delete(transmittalItemsTable).where(eq(transmittalItemsTable.id, itemId));
  res.json({ success: true });
});

// Set per-item review code
router.patch("/:id/items/:itemId", requireRole("admin", "project_manager", "document_controller", "reviewer"), async (req, res) => {
  const itemId = parseInt(req.params.itemId);
  const { reviewCode } = req.body;
  const [updated] = await db.update(transmittalItemsTable)
    .set({ reviewCode: reviewCode ?? null })
    .where(eq(transmittalItemsTable.id, itemId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(updated);
});

// Create / update share link
router.post("/:id/share", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { expiresInDays, password } = req.body;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000)
    : null;
  const passwordHash = password ? await hashPassword(password) : null;

  const [transmittal] = await db.update(transmittalsTable)
    .set({
      shareToken: token,
      shareExpiresAt: expiresAt ?? undefined,
      sharePasswordHash: passwordHash ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(transmittalsTable.id, id))
    .returning({ id: transmittalsTable.id, shareToken: transmittalsTable.shareToken, shareExpiresAt: transmittalsTable.shareExpiresAt });

  if (!transmittal) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "share", entityType: "transmittal",
    entityId: id, details: { token, expiresInDays, passwordProtected: !!password },
  });

  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({
    shareUrl: `${baseUrl}/shared/transmittal/${token}`,
    shareToken: token,
    expiresAt: expiresAt,
  });
});

// Upload external file and add as transmittal attachment (creates a stub doc)
router.post("/:id/upload-attachment", async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const transmittalId = parseInt(req.params.id);
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
router.delete("/:id/share", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.update(transmittalsTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id));
  res.json({ success: true });
});

// ─── Workflow Approval ────────────────────────────────────────────────────────
router.post(
  "/:id/submit-approval",
  requireRole("admin", "project_manager", "document_controller"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
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
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    const { comment, decision: rawDecision } = req.body;
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
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    const { comment, decision: rawDecision } = req.body;
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

export default router;
