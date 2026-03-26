import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, foldersTable, documentRevisionsTable, usersTable, workflowsTable, workflowStepsTable, tasksTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

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
  const { discipline, documentType, status, folderId } = req.query;

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

  res.json({
    documents: filtered.map(({ doc, createdBy, folder }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName: folder?.name,
    })),
    total: filtered.length,
  });
});

router.post("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { documentNumber, title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata } = req.body;

  const [doc] = await db.insert(documentsTable).values({
    documentNumber, title, documentType, discipline,
    revision: revision || "A",
    status: status || "draft",
    description, folderId,
    projectId,
    createdById: req.user!.id,
    fileUrl, fileName, fileSize,
    metadata: metadata || {},
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

  const { title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata } = req.body;

  const existing = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
  if (!existing[0]) { res.status(404).json({ error: "Not Found" }); return; }

  const [doc] = await db.update(documentsTable)
    .set({ title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, updatedAt: new Date() })
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
  res.json({ ...doc });
});

export default router;
