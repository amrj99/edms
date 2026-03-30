import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, foldersTable, documentRevisionsTable, usersTable, workflowsTable, workflowStepsTable, tasksTable, projectsTable, projectMembersTable, notificationsTable } from "@workspace/db";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { sendReviewSubmittedEmail, sendDocumentApprovedEmail, sendDocumentRejectedEmail } from "../lib/email.js";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";

const router = Router({ mergeParams: true });

// Folders
router.get("/folders", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const folders = await db.select().from(foldersTable).where(eq(foldersTable.projectId, projectId));
  const docCounts = await db.select({ folderId: documentsTable.folderId, cnt: count() })
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId))
    .groupBy(documentsTable.folderId);
  const countMap = new Map(docCounts.filter(d => d.folderId).map(d => [d.folderId!, Number(d.cnt)]));
  res.json({ folders: folders.map(f => ({ ...f, documentCount: countMap.get(f.id) ?? 0 })) });
});

router.post("/folders", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { name, parentId } = req.body;
  const [folder] = await db.insert(foldersTable).values({ name, projectId, parentId }).returning();
  res.status(201).json({ ...folder, documentCount: 0 });
});

// Documents
router.get("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { discipline, documentType, status, folderId, page, limit, search, source, issuedBy } = req.query;
  const lim = Math.min(parseInt(limit as string || "50"), 200);
  const pg = Math.max(1, parseInt(page as string || "1"));

  const docs = await db.select({
    doc: documentsTable,
    createdBy: usersTable,
    folder: foldersTable,
  }).from(documentsTable)
    .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
    .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
    .where(eq(documentsTable.projectId, projectId))
    .orderBy(desc(documentsTable.updatedAt));

  let filtered = docs;
  if (discipline) filtered = filtered.filter(d => d.doc.discipline === discipline);
  if (documentType) filtered = filtered.filter(d => d.doc.documentType === documentType);
  if (status) filtered = filtered.filter(d => d.doc.status === status);
  if (folderId) filtered = filtered.filter(d => d.doc.folderId === parseInt(folderId as string));
  if (source) filtered = filtered.filter(d => d.doc.source === source);
  if (issuedBy) {
    const ib = (issuedBy as string).toLowerCase();
    filtered = filtered.filter(d => d.doc.issuedBy?.toLowerCase().includes(ib));
  }
  if (search) {
    const q = (search as string).toLowerCase();
    filtered = filtered.filter(d =>
      d.doc.title?.toLowerCase().includes(q) ||
      d.doc.documentNumber?.toLowerCase().includes(q) ||
      d.doc.discipline?.toLowerCase().includes(q) ||
      d.doc.revision?.toLowerCase().includes(q) ||
      d.doc.documentType?.toLowerCase().includes(q) ||
      d.doc.source?.toLowerCase().includes(q) ||
      d.doc.issuedBy?.toLowerCase().includes(q)
    );
  }

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / lim);
  const paginated = filtered.slice((pg - 1) * lim, pg * lim);

  res.json({
    documents: paginated.map(({ doc, createdBy, folder }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName: folder?.name,
    })),
    total: totalCount,
    page: pg,
    totalPages,
    limit: lim,
    hasMore: pg < totalPages,
  });
});

router.post("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Request body is missing or invalid. Ensure Content-Type is application/json." });
    return;
  }
  const { documentNumber, title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, source, issuedBy } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const resolvedDocNumber = documentNumber || `DOC-${projectId}-${Date.now().toString().slice(-6)}`;

  const [doc] = await db.insert(documentsTable).values({
    documentNumber: resolvedDocNumber, title: title.trim(), documentType, discipline,
    revision: revision || "A",
    status: status || "draft",
    description, folderId,
    projectId,
    createdById: req.user!.id,
    fileUrl, fileName, fileSize,
    metadata: metadata || {},
    source, issuedBy,
  }).returning();

  // Save initial revision
  await db.insert(documentRevisionsTable).values({
    documentId: doc.id,
    revision: doc.revision,
    status: doc.status,
    fileUrl: doc.fileUrl,
    fileName: doc.fileName,
    comment: "Initial version",
    createdById: req.user!.id,
  });

  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "document", entityId: doc.id, entityTitle: doc.title, projectId });

  // Notify project members about the new document upload (excluding the uploader)
  try {
    const members = await db.select({ userId: projectMembersTable.userId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.projectId, projectId));
    const memberIds = members.map(m => m.userId).filter(uid => uid !== req.user!.id);
    if (memberIds.length > 0) {
      const [uploader] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, req.user!.id));
      const uploaderName = uploader ? `${uploader.firstName} ${uploader.lastName}`.trim() : "Someone";
      await db.insert(notificationsTable).values(
        memberIds.map(uid => ({
          userId: uid,
          type: "document_uploaded" as const,
          title: `New document: ${doc.documentNumber}`,
          message: `${uploaderName} uploaded "${doc.title}" (${doc.documentNumber} Rev ${doc.revision})`,
          projectId,
          entityType: "document",
          entityId: doc.id,
          actionUrl: `/projects/${projectId}`,
        }))
      );
    }
  } catch (_) {}

  res.status(201).json({ ...doc, createdByName: undefined, folderName: undefined });
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);

  const docs = await db.select({
    doc: documentsTable,
    createdBy: usersTable,
    folder: foldersTable,
  }).from(documentsTable)
    .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
    .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .limit(1);

  if (!docs[0]) { res.status(404).json({ error: "Not Found" }); return; }

  const workflows = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.documentId, id), eq(workflowsTable.status, "active")))
    .limit(1);

  const { doc, createdBy, folder } = docs[0];
  res.json({
    ...doc,
    createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
    folderName: folder?.name,
    workflowStatus: workflows[0]?.currentStep,
  });
});

router.put("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);

  const { title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, additionalFiles, source, issuedBy } = req.body;

  const existing = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
  if (!existing[0]) { res.status(404).json({ error: "Not Found" }); return; }

  const [doc] = await db.update(documentsTable)
    .set({ title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, additionalFiles: additionalFiles ?? existing[0].additionalFiles, source, issuedBy, updatedAt: new Date() })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .returning();

  // Save revision record if revision changed
  if (revision && revision !== existing[0].revision) {
    await db.insert(documentRevisionsTable).values({
      documentId: id,
      revision: revision,
      status: status || existing[0].status,
      fileUrl: fileUrl || existing[0].fileUrl,
      fileName: fileName || existing[0].fileName,
      comment: `Updated to revision ${revision}`,
      createdById: req.user!.id,
    });
  }

  await createAuditLog({ userId: req.user!.id, action: "update", entityType: "document", entityId: id, entityTitle: doc.title, projectId });
  res.json({ ...doc });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  await db.delete(documentRevisionsTable).where(eq(documentRevisionsTable.documentId, id));
  await db.delete(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)));
  res.status(204).send();
});

router.get("/:id/revisions", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const revisions = await db.select({
    rev: documentRevisionsTable,
    user: usersTable,
  }).from(documentRevisionsTable)
    .leftJoin(usersTable, eq(documentRevisionsTable.createdById, usersTable.id))
    .where(eq(documentRevisionsTable.documentId, id))
    .orderBy(desc(documentRevisionsTable.createdAt));

  res.json({
    revisions: revisions.map(({ rev, user }) => ({
      ...rev,
      createdByName: user ? `${user.firstName} ${user.lastName}` : undefined,
    })),
    total: revisions.length,
  });
});

router.get("/:id/reviews", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const steps = await db.select({
    step: workflowStepsTable,
    user: usersTable,
    wf: workflowsTable,
  }).from(workflowStepsTable)
    .leftJoin(workflowsTable, eq(workflowStepsTable.workflowId, workflowsTable.id))
    .leftJoin(usersTable, eq(workflowStepsTable.userId, usersTable.id))
    .where(eq(workflowsTable.documentId, id))
    .orderBy(desc(workflowStepsTable.createdAt));

  res.json({
    history: steps.map(({ step, user }) => ({
      id: step.id,
      step: step.step,
      action: step.action,
      comment: step.comment,
      createdAt: step.createdAt,
      userName: user ? `${user.firstName} ${user.lastName}` : "System",
    })),
  });
});

router.post("/:id/approve", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { comment, decision: rawDecision } = req.body;
  const decision: ReviewDecision = isValidReviewDecision(rawDecision) ? rawDecision : "approved";

  const reviewer = req.user as any;
  const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;

  const doc = await applyDocumentReviewDecision({
    documentId: id, projectId, decision, reviewerId: req.user!.id, reviewerName, comment,
  });
  if (!doc) { res.status(404).json({ error: "Not Found" }); return; }

  const workflows = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.documentId, id), eq(workflowsTable.status, "active")))
    .limit(1);

  if (workflows[0]) {
    const isFinalApproval = decision === "approved";
    await db.update(workflowsTable)
      .set({
        status: isFinalApproval ? "completed" : "active",
        currentStep: isFinalApproval ? "approved" : "under_review",
        updatedAt: new Date(),
      })
      .where(eq(workflowsTable.id, workflows[0].id));
    await db.insert(workflowStepsTable).values({
      workflowId: workflows[0].id,
      step: isFinalApproval ? "approved" : "under_review",
      action: decision as any,
      comment: comment || `Document ${decision.replace(/_/g, " ")}`,
      userId: req.user!.id,
    });
  }

  await createAuditLog({
    userId: req.user!.id, action: "approve", entityType: "document",
    entityId: id, entityTitle: doc.title, projectId, details: { decision },
  });

  if (decision === "approved" && doc.createdById) {
    const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (creator?.email) {
      sendDocumentApprovedEmail({
        to: creator.email,
        documentNumber: doc.documentNumber ?? "",
        documentTitle: doc.title,
        revision: doc.revision ?? "01",
        approvedBy: reviewerName,
        projectName: project?.name ?? "Unknown Project",
        comment,
        projectId,
      }).catch(() => {});
    }
  }

  res.json({ ...doc });
});

router.post("/:id/reject", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { comment, decision: rawDecision } = req.body;
  const decision: ReviewDecision =
    (rawDecision === "rejected" || rawDecision === "for_revision")
      ? rawDecision
      : "for_revision";

  const reviewer = req.user as any;
  const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;

  const doc = await applyDocumentReviewDecision({
    documentId: id, projectId, decision, reviewerId: req.user!.id, reviewerName, comment,
  });
  if (!doc) { res.status(404).json({ error: "Not Found" }); return; }

  const workflows = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.documentId, id), eq(workflowsTable.status, "active")))
    .limit(1);

  if (workflows[0]) {
    await db.update(workflowsTable)
      .set({ status: "rejected", currentStep: "rejected", updatedAt: new Date() })
      .where(eq(workflowsTable.id, workflows[0].id));
    await db.insert(workflowStepsTable).values({
      workflowId: workflows[0].id, step: "rejected", action: decision as any,
      comment: comment || `Document ${decision.replace(/_/g, " ")}`, userId: req.user!.id,
    });
  }

  await createAuditLog({
    userId: req.user!.id, action: "reject", entityType: "document",
    entityId: id, entityTitle: doc.title, projectId, details: { decision },
  });

  if (doc.createdById) {
    const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (creator?.email) {
      sendDocumentRejectedEmail({
        to: creator.email,
        documentNumber: doc.documentNumber ?? "",
        documentTitle: doc.title,
        revision: doc.revision ?? "01",
        rejectedBy: reviewerName,
        projectName: project?.name ?? "Unknown Project",
        comment,
        projectId,
      }).catch(() => {});
    }
  }

  res.json({ ...doc });
});

router.post("/:id/submit-review", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { reviewerIds, comment } = req.body;

  // Update document status
  const [doc] = await db.update(documentsTable)
    .set({ status: "under_review", updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();

  // Create workflow
  const [workflow] = await db.insert(workflowsTable).values({
    documentId: id,
    projectId,
    currentStep: "under_review",
    status: "active",
    initiatedById: req.user!.id,
  }).returning();

  // Log submission
  await db.insert(workflowStepsTable).values({
    workflowId: workflow.id,
    step: "under_review",
    action: "submitted",
    comment: comment || "Submitted for review",
    userId: req.user!.id,
  });

  // Create tasks for reviewers
  if (reviewerIds?.length > 0) {
    const taskValues = reviewerIds.map((uid: number) => ({
      title: `Review document: ${doc.title}`,
      description: `Please review document ${doc.documentNumber} - ${doc.title}`,
      status: "pending" as const,
      priority: "medium" as const,
      assignedToId: uid,
      createdById: req.user!.id,
      projectId,
      sourceType: "workflow" as const,
      sourceId: workflow.id,
    }));
    await db.insert(tasksTable).values(taskValues);
  }

  await createAuditLog({ userId: req.user!.id, action: "submit_review", entityType: "document", entityId: id, entityTitle: doc.title, projectId });

  // Email reviewers that they have a document to review
  if (reviewerIds?.length > 0) {
    const reviewers = await db.select().from(usersTable).where(
      // @ts-ignore — in operator
      sql`${usersTable.id} = ANY(${reviewerIds})`
    );
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    const submitter = req.user!;
    const reviewerEmails = reviewers.map((r: any) => r.email).filter(Boolean);
    if (reviewerEmails.length > 0) {
      sendReviewSubmittedEmail({
        to: reviewerEmails,
        documentNumber: doc.documentNumber ?? "",
        documentTitle: doc.title,
        revision: doc.revision ?? "01",
        submittedBy: `${(submitter as any).firstName} ${(submitter as any).lastName}`,
        projectName: project?.name ?? "Unknown Project",
        comment,
        projectId,
        documentId: id,
      }).catch(() => {});
    }
  }

  res.json({ ...doc });
});

// ─── Share link ───────────────────────────────────────────────────────────────
router.post("/:id/share", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { expiresInDays, password } = req.body;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;
  const passwordHash = password ? await hashPassword(password) : null;

  const [doc] = await db.update(documentsTable)
    .set({
      shareToken: token,
      shareExpiresAt: expiresAt ?? undefined,
      sharePasswordHash: passwordHash ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .returning({ id: documentsTable.id, shareToken: documentsTable.shareToken, shareExpiresAt: documentsTable.shareExpiresAt });

  if (!doc) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "share", entityType: "document",
    entityId: id, details: { token, expiresInDays, passwordProtected: !!password },
  });

  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({
    shareUrl: `${baseUrl}/shared/document/${token}`,
    shareToken: token,
    expiresAt,
  });
});

router.delete("/:id/share", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  await db.update(documentsTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)));
  res.json({ success: true });
});

export default router;
