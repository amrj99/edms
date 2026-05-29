import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { documentsTable, documentFilesTable, foldersTable, documentRevisionsTable, usersTable, wfInstancesTable, wfInstanceTransitionsTable, wfTemplateStagesTable, tasksTable, projectsTable, projectMembersTable, notificationsTable, organizationsTable, orgConfigTable, documentSequencesTable, transmittalsTable, transmittalItemsTable, submissionChainsTable, submissionChainDocumentsTable, correspondenceTable, correspondenceDocumentsTable, documentDepartmentsTable, departmentsTable } from "@workspace/db";
import { PLANS } from "../lib/plans.js";
import { getOrgPlan } from "../lib/plan-service.js";
import { isExpiredPlan } from "../lib/plan-normalizer.js";
import { eq, and, count, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, hashPassword, isSysAdmin, isSystemOwner, hashToken } from "../lib/auth.js";
import { checkStatusTransition } from "../lib/doc-status-machine.js";
import { resolveEffectiveRole } from "../lib/governance.js";
import { DocumentPermissions } from "../lib/permissions.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { sendReviewSubmittedEmail, sendDocumentApprovedEmail, sendDocumentRejectedEmail, sendDocumentUploadedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { getProjectRecipientsByRole } from "../lib/notifications/recipients.js";
import { emitToUser } from "../lib/socket.js";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";
import { TenantIsolationError } from '../lib/errors.js';
import { evaluateRules } from "../lib/rule-engine.js";
import { classifyItem } from "../lib/ai-service.js";
import { uploadBuffer } from "../lib/orgStorage.js";
import { resolveAndEnforce, resolveListAndEnforce } from "../lib/access-resolver.js";
import { fileFilter, validateUploadedFiles, MAX_UPLOAD_BYTES } from "../lib/file-validation.js";
import type { Request } from 'express';
import { param, paramInt, paramIntOrNull, type ProjectParams, type ProjectItemParams } from '../lib/params';

const upload = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: MAX_UPLOAD_BYTES } });

const router = Router({ mergeParams: true });

// ─── Project access helper ─────────────────────────────────────────────────
// Returns { allowed, projectOrgId }.
// SysAdmins bypass all checks. Otherwise: org-owner match OR explicit project membership.
// projectOrgId is returned so callers can pass it to the access resolver for org-boundary checks.
async function canAccessProject(
  userId: number,
  userOrgId: number | undefined,
  projectId: number,
  sysAdmin: boolean,
): Promise<{ allowed: boolean; projectOrgId: number | null }> {
  if (sysAdmin) return { allowed: true, projectOrgId: null };
  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { allowed: false, projectOrgId: null };
  const projectOrgId = project.organizationId ?? null;
  if (project.organizationId === userOrgId) return { allowed: true, projectOrgId };
  // Cross-org: check explicit project membership
  const [member] = await db.select({ userId: projectMembersTable.userId })
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)))
    .limit(1);
  return { allowed: !!member, projectOrgId };
}

// Folders
router.get("/folders", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const caller = req.user!;
  const { allowed } = await canAccessProject(caller.id, caller.organizationId, projectId, isSystemOwner(caller));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden", message: "You are not a member of this project" });
    return;
  }
  const folders = await db.select().from(foldersTable).where(eq(foldersTable.projectId, projectId));
  const docCounts = await db.select({ folderId: documentsTable.folderId, cnt: count() })
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId))
    .groupBy(documentsTable.folderId);
  const countMap = new Map(docCounts.filter(d => d.folderId).map(d => [d.folderId!, Number(d.cnt)]));
  res.json({ folders: folders.map(f => ({ ...f, documentCount: countMap.get(f.id) ?? 0 })) });
});

router.post("/folders", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const { name, parentId } = req.body;
  if (!name?.trim()) res.status(400).json({ error: "name is required" })
    return;
  const [folder] = await db.insert(foldersTable).values({ name: name.trim(), projectId, parentId: parentId ?? null }).returning();
  res.status(201).json({ ...folder, documentCount: 0 });
});

router.put("/folders/:folderId", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const folderId = paramInt(req.params.folderId);
  const projectId = paramInt(req.params.projectId);
  const { name, parentId } = req.body;
  const update: Record<string, any> = {};
  if (name !== undefined) update.name = name.trim();
  if (parentId !== undefined) update.parentId = parentId === null ? null : parseInt(parentId);
  if (!Object.keys(update).length) res.status(400).json({ error: "nothing to update" })
    return;
  const [folder] = await db.update(foldersTable)
    .set(update)
    .where(and(eq(foldersTable.id, folderId), eq(foldersTable.projectId, projectId)))
    .returning();
  if (!folder) res.status(404).json({ error: "folder not found" })
    return;
  res.json(folder);
});

router.delete("/folders/:folderId", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const folderId = paramInt(req.params.folderId);
  const projectId = paramInt(req.params.projectId);
  const [folder] = await db.select().from(foldersTable)
    .where(and(eq(foldersTable.id, folderId), eq(foldersTable.projectId, projectId)));
  if (!folder) res.status(404).json({ error: "folder not found" })
    return;
  // Move child folders to parent
  await db.update(foldersTable)
    .set({ parentId: folder.parentId ?? null })
    .where(eq(foldersTable.parentId, folderId));
  // Unset folderId on documents
  await db.update(documentsTable)
    .set({ folderId: folder.parentId ?? null })
    .where(and(eq(documentsTable.folderId, folderId), eq(documentsTable.projectId, projectId)));
  await db.delete(foldersTable).where(eq(foldersTable.id, folderId));
  res.status(204).send();
});

// POST /folders/copy-from — copy folder tree from another project in same org
router.post("/folders/copy-from", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const { sourceProjectId } = req.body;
  if (!sourceProjectId) res.status(400).json({ error: "sourceProjectId required" })
    return;
  // Verify source project is in same org
  const [srcProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, sourceProjectId));
  const [dstProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!srcProject || !dstProject || srcProject.organizationId !== dstProject.organizationId) {
    res.status(403).json({ error: "Source project not in same organization" })
    return;
  }
  const sourceFolders = await db.select().from(foldersTable).where(eq(foldersTable.projectId, sourceProjectId));
  // Insert in two passes: roots first, then children (BFS)
  const idMap = new Map<number, number>();
  const roots = sourceFolders.filter(f => !f.parentId);
  const children = sourceFolders.filter(f => f.parentId);
  for (const f of roots) {
    const [created] = await db.insert(foldersTable).values({ name: f.name, projectId, parentId: null }).returning();
    idMap.set(f.id, created.id);
  }
  // Up to 5 levels
  let remaining = children;
  for (let pass = 0; pass < 5 && remaining.length; pass++) {
    const next: typeof remaining = [];
    for (const f of remaining) {
      const newParent = idMap.get(f.parentId!);
      if (newParent !== undefined) {
        const [created] = await db.insert(foldersTable).values({ name: f.name, projectId, parentId: newParent }).returning();
        idMap.set(f.id, created.id);
      } else {
        next.push(f);
      }
    }
    remaining = next;
  }
  const newFolders = await db.select().from(foldersTable).where(eq(foldersTable.projectId, projectId));
  res.json({ folders: newFolders, copiedCount: idMap.size });
});

// Documents
router.get("/", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const caller = req.user!;
  const { allowed: projectAccessAllowed } = await canAccessProject(caller.id, caller.organizationId, projectId, isSystemOwner(caller));
  if (!projectAccessAllowed) {
    res.status(403).json({ error: "Forbidden", message: "You are not a member of this project" }); return;
  }
  const { discipline, documentType, status, folderId, page, limit, search, source, issuedBy, direction } = req.query;
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
  if (direction && (direction === "incoming" || direction === "outgoing")) filtered = filtered.filter(d => d.doc.direction === direction);
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

  // Department enforcement gate — must run on ALL filtered docs before pagination so that
  // total counts are correct after denied documents are removed.
  // When PHASE_D_ENFORCE_DEPT=false (default): fires shadow logging async, returns no denials.
  // When PHASE_D_ENFORCE_DEPT=true: awaits batch evaluation, returns denied doc IDs to filter.
  const { deniedDocIds } = await resolveListAndEnforce({
    userId:    caller.id,
    userRole:  caller.role,
    documents: filtered.map(({ doc }) => ({
      id:             doc.id,
      projectId:      doc.projectId,
      isConfidential: doc.isConfidential ?? false,
    })),
    endpoint: "GET /api/projects/:projectId/documents",
  });
  if (deniedDocIds.size > 0) {
    filtered = filtered.filter(d => !deniedDocIds.has(d.doc.id));
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

router.post("/", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Request body is missing or invalid. Ensure Content-Type is application/json." });
    return;
  }

  // Tenant isolation: verify the project belongs to the caller's organization
  if (!isSystemOwner(req.user!)) {
    const [projCheck] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!projCheck) { res.status(404).json({ error: "Not Found" }); return; }
    if (projCheck.organizationId !== req.user!.organizationId) {
      throw new TenantIsolationError({ userId: req.user!.id, userOrgId: req.user!.organizationId, resourceOrgId: projCheck.organizationId, resource: "project", resourceId: projectId });
    }
  }

  const { documentNumber, title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, source, issuedBy, direction } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  // Document numbers are immutable once assigned — never update documentNumber after creation.
  // If not supplied, generate one using the project's owning org's numbering template + scoped SEQ counter.
  let resolvedDocNumber: string;
  if (documentNumber) {
    resolvedDocNumber = documentNumber;
  } else {
    // Resolve the project's owning organization (not the current user's org)
    const [proj] = await db.select({ code: projectsTable.code, organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    const ownerOrgId = proj?.organizationId;

    if (!ownerOrgId) {
      resolvedDocNumber = `DOC-${projectId}-${Date.now().toString().slice(-6)}`;
    } else {
      const [org] = await db.select({ code: organizationsTable.code })
        .from(organizationsTable).where(eq(organizationsTable.id, ownerOrgId)).limit(1);
      const [cfg] = await db.select({ fmt: orgConfigTable.documentNumberingFormat })
        .from(orgConfigTable).where(eq(orgConfigTable.organizationId, ownerOrgId)).limit(1);
      const fmt = cfg?.fmt;

      if (!fmt || !fmt.includes("{SEQ}")) {
        // No sequence-based template — use simple fallback
        resolvedDocNumber = `DOC-${projectId}-${Date.now().toString().slice(-6)}`;
      } else {
        // Atomically upsert the sequence counter for this scope and get the new value
        const disc = (discipline ?? "").toLowerCase();
        const dtype = (documentType ?? "").toLowerCase();
        const [seqRow] = await db.insert(documentSequencesTable)
          .values({ projectId, organizationId: ownerOrgId, discipline: disc, docType: dtype, lastSeq: 1 })
          .onConflictDoUpdate({
            target: [documentSequencesTable.projectId, documentSequencesTable.organizationId, documentSequencesTable.discipline, documentSequencesTable.docType],
            set: { lastSeq: sql`document_sequences.last_seq + 1` },
          })
          .returning({ lastSeq: documentSequencesTable.lastSeq });
        const seq = seqRow?.lastSeq ?? 1;
        const seqStr = String(seq).padStart(3, "0");
        resolvedDocNumber = fmt
          .replace("{PROJECT}", proj?.code ?? `P${projectId}`)
          .replace("{ORG}", org?.code ?? "ORG")
          .replace("{DISCIPLINE}", (discipline ?? "GEN").substring(0, 3).toUpperCase())
          .replace("{TYPE}", (documentType ?? "DWG").substring(0, 3).toUpperCase())
          .replace("{SEQ}", seqStr);
      }
    }
  }

  // Pre-check for document number uniqueness before insert (cleaner UX than catching DB error)
  if (resolvedDocNumber) {
    const dup = await db.select({ id: documentsTable.id, title: documentsTable.title })
      .from(documentsTable)
      .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.documentNumber, resolvedDocNumber)))
      .limit(1);
    if (dup.length > 0) {
      res.status(409).json({
        error: "Document number already exists in this project",
        code: "DUPLICATE_DOCUMENT_NUMBER",
        existingDocumentId: dup[0].id,
        existingTitle: dup[0].title,
        documentNumber: resolvedDocNumber,
      })
    return;
    }
  }

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
    direction: direction === "incoming" || direction === "outgoing" ? direction : null,
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

  // Create document_files entry for the primary file (one-to-many support)
  if (fileUrl && fileName) {
    try {
      await db.insert(documentFilesTable).values({
        documentId: doc.id,
        fileUrl,
        fileName,
        fileSize: fileSize ?? null,
        fileType: req.body.fileType ?? null,
        uploadedById: req.user!.id,
      });
    } catch (_) {}
  }

  // AI classification (non-blocking — enhances metadata and is persisted to document record)
  let aiClassification: { category?: string; tags?: string[]; priority?: string } = {};
  try {
    aiClassification = await classifyItem({
      type: "document",
      organizationId: req.user!.organizationId,
      title: doc.title,
      documentType: doc.documentType,
      discipline: doc.discipline,
    }) ?? {};
    if (aiClassification.tags?.length || aiClassification.priority) {
      await db.update(documentsTable).set({
        aiTags: aiClassification.tags ?? [],
        aiPriority: aiClassification.priority ?? null,
      }).where(eq(documentsTable.id, doc.id));
    }
  } catch (_) {}

  // Rules engine — evaluate and execute matching automation rules
  try {
    const orgId = req.user!.organizationId;
    if (orgId) {
      await evaluateRules({
        type: "document",
        orgId,
        projectId,
        documentType: doc.documentType,
        discipline: doc.discipline,
        subject: doc.title,
        senderUserId: req.user!.id,
        entityId: doc.id,
        entityTitle: doc.title,
        triggeredByUserId: req.user!.id,
      });
    }
  } catch (_) {}

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

  // Email notification for document_uploaded (non-blocking, respects user prefs)
  try {
    const [uploader] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    const uploaderName = uploader ? `${uploader.firstName} ${uploader.lastName}`.trim() : "Someone";
    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    const recipients = await getProjectRecipientsByRole(projectId, ["admin", "project_manager"]);
    const filtered = recipients.filter(r => r.userId !== req.user!.id);
    await dispatchNotification({
      event: "document_uploaded",
      recipients: filtered,
      sendEmail: (to) => sendDocumentUploadedEmail({
        to,
        documentNumber: doc.documentNumber ?? "",
        documentTitle: doc.title,
        revision: doc.revision ?? "A",
        uploadedBy: uploaderName,
        projectName: project?.name ?? "Unknown Project",
        documentType: doc.documentType ?? undefined,
        discipline: doc.discipline ?? undefined,
        projectId,
      }),
    });
  } catch (_) {}

  res.status(201).json({ ...doc, aiClassification, createdByName: undefined, folderName: undefined });
});

// GET /check-number?number=X — check if a document number already exists in this project
router.get("/check-number", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const number = (req.query.number as string)?.trim();
  if (!number) res.status(400).json({ error: "number query param required" })
    return;

  const existing = await db.select({
    id: documentsTable.id,
    title: documentsTable.title,
    revision: documentsTable.revision,
    status: documentsTable.status,
    discipline: documentsTable.discipline,
  })
    .from(documentsTable)
    .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.documentNumber, number)))
    .limit(1);

  if (existing.length > 0) {
    res.json({
      available: false,
      existingDocumentId: existing[0].id,
      existingTitle: existing[0].title,
      existingRevision: existing[0].revision,
      existingStatus: existing[0].status,
      existingDiscipline: existing[0].discipline,
    })
    return;
  }
  res.json({ available: true })
    return;
});

router.get("/:id", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const caller = req.user!;
  const { allowed: projectAccessAllowed, projectOrgId } = await canAccessProject(
    caller.id, caller.organizationId, projectId, isSystemOwner(caller),
  );
  if (!projectAccessAllowed) {
    res.status(403).json({ error: "Forbidden", message: "You are not a member of this project" }); return;
  }

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

  // Fetch active workflow engine instance (if any) for this document
  const wfInstances = await db.select({
    wf: wfInstancesTable,
    stage: wfTemplateStagesTable,
  }).from(wfInstancesTable)
    .leftJoin(wfTemplateStagesTable, eq(wfInstancesTable.currentStageId, wfTemplateStagesTable.id))
    .where(and(eq(wfInstancesTable.documentId, id), eq(wfInstancesTable.status, "active")))
    .limit(1);

  const { doc, createdBy, folder } = docs[0];

  // Resolver + enforcement gate — system allowed this project-scoped access.
  // resolveAndEnforce() handles shadow logging AND enforcement (enforcement off by default).
  // MUST be awaited before res.json() so enforcement can block if flag is enabled.
  const { enforcedDeny } = await resolveAndEnforce(
    {
      userId: caller.id, userRole: caller.role, documentId: id, projectId,
      isConfidential: doc.isConfidential ?? false,
      userOrgId:     caller.organizationId,
      documentOrgId: projectOrgId ?? undefined,
    },
    true,
  );
  if (enforcedDeny) { res.status(403).json({ error: "Forbidden" }); return; }

  res.json({
    ...doc,
    createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
    folderName: folder?.name,
    workflowStatus: wfInstances[0]?.stage?.name ?? null,
    workflowInstanceId: wfInstances[0]?.wf?.id ?? null,
  });
});

router.put("/:id", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const caller = req.user!;

  const { title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, additionalFiles, source, issuedBy, direction } = req.body;

  const existing = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
  if (!existing[0]) { res.status(404).json({ error: "Not Found" }); return; }

  // Resolve effective role (respects project-level overrides, delegations, project member roles)
  const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId);

  // DC+ or the document creator may edit
  const canEdit = DocumentPermissions.canEdit(effectiveRole) || existing[0].createdById === caller.id;
  if (!canEdit) { res.status(403).json({ error: "Forbidden", message: "You do not have permission to edit this document" }); return; }

  const currentStatus = existing[0].status;
  const statusChanging = status !== undefined && status !== currentStatus;

  // Status changes: enforce role minimum and valid state-machine transition
  if (statusChanging) {
    if (!DocumentPermissions.canEdit(effectiveRole)) {
      res.status(403).json({ error: "Forbidden", message: "Only document controllers and above can change document status" }); return;
    }
    const transitionError = checkStatusTransition(currentStatus, status, effectiveRole);
    if (transitionError) {
      res.status(403).json({ error: "Forbidden", message: transitionError.message }); return;
    }
  }

  const [doc] = await db.update(documentsTable)
    .set({ title, documentType, discipline, revision, status, description, folderId, fileUrl, fileName, fileSize, metadata, additionalFiles: additionalFiles ?? existing[0].additionalFiles, source, issuedBy, direction: direction === "incoming" || direction === "outgoing" ? direction : (direction === null ? null : existing[0].direction), updatedAt: new Date() })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .returning();

  // Save revision record if revision changed
  if (revision && revision !== existing[0].revision) {
    const isNewFile = !!fileUrl;
    await db.insert(documentRevisionsTable).values({
      documentId: id,
      revision: revision,
      status: status || currentStatus,
      fileUrl: fileUrl || existing[0].fileUrl,
      fileName: fileName || existing[0].fileName,
      comment: (req.body.revisionNotes?.trim()) || (isNewFile ? `Updated to revision ${revision}` : `Revision ${revision} — no new file uploaded`),
      createdById: req.user!.id,
      fileCarriedForward: !isNewFile,
    });
  }

  if (statusChanging) {
    await createAuditLog({
      userId: req.user!.id,
      action: "status_change",
      entityType: "document",
      entityId: id,
      entityTitle: doc.title,
      projectId,
      details: { fromStatus: currentStatus, toStatus: status, via: "manual_edit", actorRole: effectiveRole },
    });
  }

  await createAuditLog({ userId: req.user!.id, action: "update", entityType: "document", entityId: id, entityTitle: doc.title, projectId });
  res.json({ ...doc });
});

// Statuses that are protected from deletion (lifecycle governance).
// Only sysAdmin can hard-delete these, and must provide a mandatory reason.
const LIFECYCLE_LOCKED_STATUSES = new Set(["approved", "approved_with_comments", "issued", "archived", "obsolete", "superseded"]);

router.delete("/:id", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const caller = req.user!;
  const { reason } = req.body ?? {};

  const [existing] = await db.select({ createdById: documentsTable.createdById, title: documentsTable.title, documentNumber: documentsTable.documentNumber, status: documentsTable.status }).from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }

  const isLocked = LIFECYCLE_LOCKED_STATUSES.has(existing.status);

  // Resolve effective role for this project context
  const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId);

  if (isLocked) {
    // Lifecycle-locked documents can only be hard-deleted by admin+ with a mandatory reason
    if (!DocumentPermissions.canAdminOverrideApproval(effectiveRole)) {
      res.status(403).json({
        error: "Forbidden",
        message: `Documents with status '${existing.status}' cannot be deleted. Use Archive or Mark Obsolete instead.`,
        suggestion: "archive_or_obsolete",
      }); return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ error: "A reason is required to hard-delete a lifecycle-locked document" }); return;
    }
  } else {
    // Unlocked documents (draft, under_review): DC+ or creator can delete
    const canDelete = DocumentPermissions.canDelete(effectiveRole, existing.status) || existing.createdById === caller.id;
    if (!canDelete) { res.status(403).json({ error: "Forbidden", message: "Only document controllers, project managers, admins, or the document creator can delete documents in early stages" }); return; }
  }

  await db.delete(documentRevisionsTable).where(eq(documentRevisionsTable.documentId, id));
  await db.delete(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)));
  await createAuditLog({
    userId: caller.id,
    action: isLocked ? "hard_delete" : "delete",
    entityType: "document",
    entityId: id,
    entityTitle: `${existing.documentNumber} — ${existing.title}`,
    projectId,
    details: isLocked ? { reason: reason?.trim(), priorStatus: existing.status } : undefined,
  });
  res.status(204).send();
});

// PATCH /:id/folder — move document to a different folder (or root)
router.patch("/:id/folder", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const { folderId } = req.body;  // null = move to root
  const [doc] = await db.update(documentsTable)
    .set({ folderId: folderId ?? null, updatedAt: new Date() })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .returning();
  if (!doc) res.status(404).json({ error: "Document not found" })
    return;
  res.json({ id: doc.id, folderId: doc.folderId });
});

router.get("/:id/revisions", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const user = req.user!;

  // Tenant isolation: verify the document belongs to the user's org before returning revisions
  if (!isSysAdmin(user) && user.organizationId) {
    const [doc] = await db.select({ organizationId: documentsTable.organizationId })
      .from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    if (!doc) { res.status(404).json({ error: "Not Found" }); return; }
    if (doc.organizationId !== null && doc.organizationId !== user.organizationId) {
      throw new TenantIsolationError({
        route: req.path, method: req.method,
        userId: user.id, userOrgId: user.organizationId,
        attemptedResourceType: "document_revisions", attemptedResourceId: id,
        resourceOrgId: doc.organizationId,
      });
    }
  }

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

// ─── GET /:id/activity — unified chronological history for a document ────────
// Returns revisions + transmittals + submission chains merged and sorted by date.
// Shape is stable and extensible: adding correspondence later requires only
// appending another typed block to the merge array, with no frontend shape change.
router.get("/:id/activity", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const docId   = paramInt(req.params.id);
  const projectId = parseInt(req.params.projectId ?? "0");

  // 1 ── Revisions ───────────────────────────────────────────────────────────
  const revisionRows = await db
    .select({ rev: documentRevisionsTable, user: usersTable })
    .from(documentRevisionsTable)
    .leftJoin(usersTable, eq(documentRevisionsTable.createdById, usersTable.id))
    .where(eq(documentRevisionsTable.documentId, docId))
    .orderBy(desc(documentRevisionsTable.createdAt));

  const revisionEvents = revisionRows.map(({ rev, user }) => ({
    id:     `rev-${rev.id}`,
    type:   "revision" as const,
    date:   (rev.createdAt as Date).toISOString(),
    title:  rev.revision ? `Revision ${rev.revision} uploaded` : "Document uploaded",
    status: rev.status ?? null,
    meta: {
      revision:       rev.revision ?? null,
      createdByName:  user ? `${user.firstName} ${user.lastName}` : null,
      notes:          (rev as any).notes ?? null,
      fileName:       rev.fileName ?? null,
    },
    href: `/documents/${docId}?tab=revisions`,
  }));

  // 2 ── Transmittals (via transmittal_items join) ───────────────────────────
  const txRows = await db
    .select({
      tx:   transmittalsTable,
      item: transmittalItemsTable,
    })
    .from(transmittalItemsTable)
    .innerJoin(transmittalsTable, eq(transmittalItemsTable.transmittalId, transmittalsTable.id))
    .where(eq(transmittalItemsTable.documentId, docId))
    .orderBy(desc(transmittalsTable.createdAt));

  // Deduplicate by transmittal ID (a document may appear multiple times in one transmittal)
  const seenTx = new Set<number>();
  const transmittalEvents = txRows
    .filter(({ tx }) => { if (seenTx.has(tx.id)) return false; seenTx.add(tx.id); return true; })
    .map(({ tx }) => ({
      id:     `tx-${tx.id}`,
      type:   "transmittal" as const,
      date:   (tx.sentAt ?? tx.createdAt as Date).toISOString(),
      title:  `Transmittal ${tx.transmittalNumber}${tx.subject ? `: ${tx.subject}` : ""}`,
      status: tx.status ?? null,
      meta: {
        transmittalNumber: tx.transmittalNumber,
        subject:           tx.subject ?? null,
        purpose:           tx.purpose ?? null,
        direction:         tx.direction ?? null,
        toExternal:        tx.toExternal ?? null,
        dueDate:           tx.dueDate ? (tx.dueDate as Date).toISOString() : null,
        approvalStatus:    tx.approvalStatus ?? null,
      },
      href: `/projects/${tx.projectId}/transmittals`,
    }));

  // 3 ── Submission Chains (via submission_chain_documents join) ─────────────
  const chainRows = await db
    .select({
      chain: submissionChainsTable,
      doc:   submissionChainDocumentsTable,
    })
    .from(submissionChainDocumentsTable)
    .innerJoin(submissionChainsTable, eq(submissionChainDocumentsTable.chainId, submissionChainsTable.id))
    .where(eq(submissionChainDocumentsTable.documentId, docId))
    .orderBy(desc(submissionChainDocumentsTable.addedAt));

  // Deduplicate by chain ID
  const seenChain = new Set<number>();
  const chainEvents = chainRows
    .filter(({ chain }) => { if (seenChain.has(chain.id)) return false; seenChain.add(chain.id); return true; })
    .map(({ chain, doc }) => ({
      id:     `sc-${chain.id}`,
      type:   "chain" as const,
      date:   (doc.addedAt ?? chain.createdAt as Date).toISOString(),
      title:  `Added to submission chain: ${chain.title}`,
      status: chain.currentStatus ?? null,
      meta: {
        chainTitle:  chain.title,
        chainStatus: chain.status ?? null,
        chainRef:    (chain as any).referenceNumber ?? null,
      },
      href: `/projects/${chain.projectId}/submission-chains`,
    }));

  // 4 ── Correspondence (via correspondence_documents join table) ───────────────
  const corrRows = await db
    .select({
      corr: correspondenceTable,
      link: correspondenceDocumentsTable,
    })
    .from(correspondenceDocumentsTable)
    .innerJoin(correspondenceTable, eq(correspondenceDocumentsTable.correspondenceId, correspondenceTable.id))
    .where(eq(correspondenceDocumentsTable.documentId, docId))
    .orderBy(desc(correspondenceTable.createdAt));

  const seenCorr = new Set<number>();
  const correspondenceEvents = corrRows
    .filter(({ corr }) => { if (seenCorr.has(corr.id)) return false; seenCorr.add(corr.id); return true; })
    .map(({ corr }) => ({
      id:     `corr-${corr.id}`,
      type:   "correspondence" as const,
      date:   (corr.sentAt ?? corr.createdAt as Date).toISOString(),
      title:  corr.subject || corr.referenceNumber || `Correspondence #${corr.id}`,
      status: corr.status ?? null,
      meta: {
        referenceNumber: corr.referenceNumber ?? null,
        subject:         corr.subject ?? null,
        direction:       corr.direction ?? null,
        type:            corr.type ?? null,
        priority:        corr.priority ?? null,
        dueDate:         corr.dueDate ? (corr.dueDate as Date).toISOString() : null,
      },
      href: `/projects/${corr.projectId}/correspondence`,
    }));

  // 5 ── Merge & sort chronologically (oldest first — lifecycle narrative) ─────
  const events = [...revisionEvents, ...transmittalEvents, ...chainEvents, ...correspondenceEvents]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  res.json({ events, total: events.length });
});

router.get("/:id/reviews", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);

  // Look up workflow instances for this document, then their transitions
  const instances = await db.select({ id: wfInstancesTable.id })
    .from(wfInstancesTable)
    .where(eq(wfInstancesTable.documentId, id));

  if (instances.length === 0) {
    res.json({ history: [] })
    return;
  }

  const instanceIds = instances.map(i => i.id);

  const transitions = await db.select({
    transition: wfInstanceTransitionsTable,
    actor: usersTable,
    toStage: wfTemplateStagesTable,
  }).from(wfInstanceTransitionsTable)
    .leftJoin(usersTable, eq(wfInstanceTransitionsTable.actorId, usersTable.id))
    .leftJoin(wfTemplateStagesTable, eq(wfInstanceTransitionsTable.toStageId, wfTemplateStagesTable.id))
    .where(inArray(wfInstanceTransitionsTable.instanceId, instanceIds))
    .orderBy(desc(wfInstanceTransitionsTable.createdAt));

  res.json({
    history: transitions.map(({ transition, actor, toStage }) => ({
      id: transition.id,
      step: toStage?.name ?? transition.action,
      action: transition.action,
      comment: transition.comment,
      createdAt: transition.createdAt,
      userName: actor ? `${actor.firstName} ${actor.lastName}` : "System",
    })),
  });
});

router.post("/:id/approve", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const caller = req.user!;
  // Direct approve is an admin override only — normal approvals go through the Workflow Engine
  if (!isSysAdmin(caller)) {
    res.status(403).json({ error: "Forbidden", message: "Direct document approval is an admin override. Use the Workflow Engine for standard approvals." }); return;
  }
  const { comment, decision: rawDecision } = req.body;
  if (!comment?.trim()) {
    res.status(400).json({ error: "A comment is required for admin override approvals" }); return;
  }

  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);

  // Tenant isolation: org-level admins may only approve documents in their own org
  if (!isSystemOwner(caller)) {
    const [projCheck] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!projCheck) { res.status(404).json({ error: "Not Found" }); return; }
    if (projCheck.organizationId !== caller.organizationId) {
      throw new TenantIsolationError({ userId: caller.id, userOrgId: caller.organizationId, resourceOrgId: projCheck.organizationId, resource: "project", resourceId: projectId });
    }
  }
  const decision: ReviewDecision = isValidReviewDecision(rawDecision) ? rawDecision : "approved";

  const reviewer = req.user as any;
  const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;

  const doc = await applyDocumentReviewDecision({
    documentId: id, projectId, decision, reviewerId: req.user!.id, reviewerName, comment,
  });
  if (!doc) { res.status(404).json({ error: "Not Found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "approve", entityType: "document",
    entityId: id, entityTitle: doc.title, projectId, details: { decision },
  });

  if (decision === "approved" && doc.createdById) {
    const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (creator?.email) {
      dispatchNotification({
        event: "document_approved",
        recipients: [{ userId: doc.createdById, email: creator.email, name: `${creator.firstName} ${creator.lastName}`.trim() }],
        sendEmail: (to) => sendDocumentApprovedEmail({
          to: to[0],
          documentNumber: doc.documentNumber ?? "",
          documentTitle: doc.title,
          revision: doc.revision ?? "01",
          approvedBy: reviewerName,
          projectName: project?.name ?? "Unknown Project",
          comment,
          projectId,
        }),
      }).catch(() => {});
    }
    // In-app notification to the document creator
    if (doc.createdById && doc.createdById !== req.user!.id) {
      try {
        await db.insert(notificationsTable).values({
          userId: doc.createdById,
          type: "document_approved" as const,
          title: `Document approved: ${doc.documentNumber}`,
          message: `${reviewerName} approved "${doc.title}" (${doc.documentNumber} Rev ${doc.revision})${comment ? ` — ${comment}` : ""}`,
          projectId: projectId || null,
          entityType: "document",
          entityId: id,
          actionUrl: `/projects/${projectId}`,
        });
      } catch (_) {}
    }
  }

  res.json({ ...doc });
});

router.post("/:id/reject", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const caller = req.user!;
  // Direct reject is an admin override only — normal rejections go through the Workflow Engine
  if (!isSysAdmin(caller)) {
    res.status(403).json({ error: "Forbidden", message: "Direct document rejection is an admin override. Use the Workflow Engine for standard review actions." }); return;
  }
  const { comment, decision: rawDecision } = req.body;
  if (!comment?.trim()) {
    res.status(400).json({ error: "A comment is required for admin override actions" }); return;
  }

  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
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

  await createAuditLog({
    userId: req.user!.id, action: "reject", entityType: "document",
    entityId: id, entityTitle: doc.title, projectId, details: { decision },
  });

  if (doc.createdById) {
    const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (creator?.email) {
      dispatchNotification({
        event: "document_rejected",
        recipients: [{ userId: doc.createdById, email: creator.email, name: `${creator.firstName} ${creator.lastName}`.trim() }],
        sendEmail: (to) => sendDocumentRejectedEmail({
          to: to[0],
          documentNumber: doc.documentNumber ?? "",
          documentTitle: doc.title,
          revision: doc.revision ?? "01",
          rejectedBy: reviewerName,
          projectName: project?.name ?? "Unknown Project",
          comment,
          projectId,
        }),
      }).catch(() => {});
    }
    // In-app notification to the document creator
    if (doc.createdById !== req.user!.id) {
      try {
        const decisionLabel = decision === "rejected" ? "rejected" : "returned for revision";
        await db.insert(notificationsTable).values({
          userId: doc.createdById,
          type: "document_rejected" as const,
          title: `Document ${decisionLabel}: ${doc.documentNumber}`,
          message: `${reviewerName} ${decisionLabel} "${doc.title}" (${doc.documentNumber} Rev ${doc.revision})${comment ? ` — ${comment}` : ""}`,
          projectId: projectId || null,
          entityType: "document",
          entityId: id,
          actionUrl: `/projects/${projectId}`,
        });
      } catch (_) {}
    }
  }

  res.json({ ...doc });
});

router.post("/:id/submit-review", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const { reviewerIds, comment } = req.body;

  // Update document status
  const [doc] = await db.update(documentsTable)
    .set({ status: "under_review", updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();

  // Create review tasks for each assigned reviewer
  if (reviewerIds?.length > 0) {
    const taskValues = reviewerIds.map((uid: number) => ({
      title: `Review document: ${doc.title}`,
      description: `Please review document ${doc.documentNumber} - ${doc.title}`,
      status: "pending" as const,
      priority: "medium" as const,
      assignedToId: uid,
      createdById: req.user!.id,
      projectId,
      sourceType: "document" as const,
      sourceId: id,
    }));
    await db.insert(tasksTable).values(taskValues);
  }

  await createAuditLog({ userId: req.user!.id, action: "submit_review", entityType: "document", entityId: id, entityTitle: doc.title, projectId });

  // In-app notification: notify each reviewer about the approval request
  if (reviewerIds?.length > 0) {
    try {
      const submitter = req.user as any;
      const submitterName = `${submitter.firstName} ${submitter.lastName}`.trim();
      const reviewerUserIds = reviewerIds.filter((uid: number) => uid !== req.user!.id);
      if (reviewerUserIds.length > 0) {
        const inserted = await db.insert(notificationsTable).values(
          reviewerUserIds.map((uid: number) => ({
            userId: uid,
            type: "document_approval_request" as const,
            title: `Document review request: ${doc.documentNumber}`,
            message: `${submitterName} submitted "${doc.title}" (${doc.documentNumber} Rev ${doc.revision}) for your review`,
            projectId: projectId || null,
            entityType: "document",
            entityId: id,
            actionUrl: `/projects/${projectId}`,
          }))
        ).returning();
        // Real-time: notify each reviewer immediately
        for (const n of inserted) emitToUser(n.userId, "notification:new", n);
      }
    } catch (_) {}
  }

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
router.post("/:id/share", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const { expiresInDays, password } = req.body;

  // Verify the project belongs to the caller's org — prevents cross-tenant share
  // creation when the document's own organizationId is NULL (legacy unseeded data).
  const [project] = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, req.user!.organizationId!)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Not found" }); return; }

  const token = crypto.randomBytes(32).toString("hex");
  const days = Math.min(Math.max(parseInt(expiresInDays) || 30, 1), 90);
  const expiresAt = new Date(Date.now() + days * 86400000);
  const passwordHash = password ? await hashPassword(password) : null;

  const [doc] = await db.update(documentsTable)
    .set({
      shareToken: hashToken(token),
      shareExpiresAt: expiresAt,
      sharePasswordHash: passwordHash ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .returning({ id: documentsTable.id, shareExpiresAt: documentsTable.shareExpiresAt });

  if (!doc) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "share", entityType: "document",
    entityId: id, details: { expiresInDays: days, passwordProtected: !!password },
  });

  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({
    shareUrl: `${baseUrl}/shared/document/${token}`,
    shareToken: token,
    expiresAt,
  });
});

router.delete("/:id/share", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  await db.update(documentsTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)));
  res.json({ success: true });
});

// ─── Document Files (one-to-many attachments) ─────────────────────────────────

// GET /api/projects/:projectId/documents/:id/files
router.get("/:id/files", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const docId = paramInt(req.params.id);

  // Verify document belongs to project
  const [doc] = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, docId), eq(documentsTable.projectId, projectId)));
  if (!doc) res.status(404).json({ error: "Document not found" })
    return;

  const files = await db.select({
    file: documentFilesTable,
    uploader: usersTable,
  }).from(documentFilesTable)
    .leftJoin(usersTable, eq(documentFilesTable.uploadedById, usersTable.id))
    .where(eq(documentFilesTable.documentId, docId));

  res.json({
    files: files.map(({ file, uploader }) => ({
      ...file,
      uploadedByName: uploader ? `${uploader.firstName} ${uploader.lastName}`.trim() : undefined,
    })),
  });
});

// POST /api/projects/:projectId/documents/:id/files — add files to a document
// Accepts multipart/form-data with field "files" (one or many).
// Optional form fields: documentId (ignored, taken from URL), metadata (JSON string).
router.post("/:id/files", requireAuth, upload.array("files"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const docId = paramInt(req.params.id);

  const [doc] = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, docId), eq(documentsTable.projectId, projectId)));
  if (!doc) res.status(404).json({ error: "Document not found" })
    return;

  const uploadedFiles = req.files as Express.Multer.File[] | undefined;
  if (!uploadedFiles || uploadedFiles.length === 0) {
    res.status(400).json({ error: "No files provided. Send files as multipart/form-data with field name 'files'." })
    return;
  }

  // Content-based safety check — catches HTML/SVG regardless of declared MIME or extension
  const contentError = validateUploadedFiles(uploadedFiles);
  if (contentError) {
    res.status(400).json({ error: "UNSAFE_FILE_TYPE", message: contentError })
    return;
  }

  const orgId = req.user!.organizationId ?? null;

  // ── system_owner full bypass ─────────────────────────────────────────────
  // system_owner is a platform-level actor and must never be blocked by
  // per-org quota or restriction logic (trial expiry, upload block, storage
  // quota). This mirrors the global read-only override bypass in routes/index.ts.
  const skipQuotaChecks = req.user?.role === "system_owner";

  // ── Email verification gate ──────────────────────────────────────────────
  // Users must verify their email before uploading files.
  //
  // Exempt roles (skipEmailGate):
  //   system_owner — platform-level actor; no verification token is issued at
  //     account creation (first-user path or seed), so the column is always NULL.
  //   admin — created administratively via POST /api/users; no verification token
  //     or email is sent at creation. Blocking admins from uploading is a data
  //     integrity hazard (they manage documents on behalf of the org).
  //
  // All other roles (project_manager, document_controller, reviewer, member,
  // viewer) must have email_verified_at set before uploading.
  const skipEmailGate = req.user?.role === "system_owner" || req.user?.role === "admin";
  if (!skipEmailGate) {
    const [uploader] = await db
      .select({ emailVerifiedAt: usersTable.emailVerifiedAt })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id))
      .limit(1);
    if (uploader && !uploader.emailVerifiedAt) {
      res.status(403).json({
        error: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address before uploading files. Check your inbox for a verification link.",
      })
    return;
    }
  }

  // ── Trial-expired upload block ────────────────────────────────────────────
  // Orgs that were on trial and have been downgraded to free (trialEndsAt IS
  // NOT NULL) may not upload new files. Brand-new free orgs (trialEndsAt IS
  // NULL) are not affected — they can still upload up to their storage quota.
  if (!skipQuotaChecks && orgId) {
    const [uploadOrgCheck] = await db
      .select({ subscriptionTier: organizationsTable.subscriptionTier, trialEndsAt: organizationsTable.trialEndsAt })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);
    if (isExpiredPlan(uploadOrgCheck?.subscriptionTier) && uploadOrgCheck?.trialEndsAt !== null) {
      res.status(403).json({
        error: "UPLOAD_BLOCKED",
        message: "File uploads are not available on the free plan. Upgrade your plan to continue.",
      })
    return;
    }
  }

  // ── Storage quota check ──────────────────────────────────────────────────
  if (!skipQuotaChecks && orgId) {
    const totalNewBytes = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    const totalNewMb = totalNewBytes / (1024 * 1024);

    // Phase 1: resolve plan via SSOT (subscriptions table → fallback to org.subscription_tier)
    const [orgStorage] = await db
      .select({ storageUsedMb: organizationsTable.storageUsedMb, subscriptionTier: organizationsTable.subscriptionTier, trialEndsAt: organizationsTable.trialEndsAt })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId));

    // ── Trial expiry gate ────────────────────────────────────────────────
    if (orgStorage?.subscriptionTier === "trial" && orgStorage.trialEndsAt && new Date() > new Date(orgStorage.trialEndsAt)) {
      res.status(403).json({
        error: "TRIAL_EXPIRED",
        message: "Your 14-day trial has ended. Upgrade to a paid plan to continue uploading files.",
      })
    return;
    }

    const planId = await getOrgPlan(orgId);
    const plan = PLANS.find(p => p.id === planId);
    if (plan) {
      // Per-plan file size enforcement
      const maxFileSizeMb = plan.maxFileSizeMb ?? 1024;
      const oversized = uploadedFiles.filter(f => f.size / (1024 * 1024) > maxFileSizeMb);
      if (oversized.length > 0) {
        const names = oversized.map(f => f.originalname).join(", ");
        res.status(413).json({
          error: "FILE_TOO_LARGE",
          message: `File(s) exceed the ${maxFileSizeMb >= 1024 ? `${maxFileSizeMb / 1024} GB` : `${maxFileSizeMb} MB`} upload limit on your ${plan.name} plan: ${names}`,
        })
    return;
      }

      // Storage quota enforcement
      if (orgStorage) {
        const usedMb = orgStorage.storageUsedMb ?? 0;
        if (usedMb + totalNewMb > plan.storageMb) {
          res.status(403).json({
            error: "STORAGE_LIMIT_REACHED",
            message: `Storage limit reached. Your ${plan.name} plan allows ${plan.storageMb / 1024} GB. Used: ${usedMb.toFixed(1)} MB of ${plan.storageMb} MB.`,
          })
    return;
        }
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const uploader = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).then(r => r[0]);
  const uploadedByName = uploader ? `${uploader.firstName} ${uploader.lastName}`.trim() : undefined;

  const results = [];
  let totalUploadedBytes = 0;
  for (const multerFile of uploadedFiles) {
    // Upload buffer to org-aware storage backend
    const stored = await uploadBuffer({
      organizationId: orgId,
      projectId,
      fileType: "document",
      name: multerFile.originalname,
      buffer: multerFile.buffer,
      contentType: multerFile.mimetype,
    });

    const [dbFile] = await db.insert(documentFilesTable).values({
      documentId: docId,
      fileUrl: stored.serveUrl,
      fileName: multerFile.originalname,
      fileSize: multerFile.size,
      fileType: multerFile.mimetype,
      uploadedById: req.user!.id,
    }).returning();

    await createAuditLog({
      userId: req.user!.id,
      action: "update",
      entityType: "document",
      entityId: docId,
      entityTitle: `${doc.title} — added file: ${multerFile.originalname}`,
      projectId,
    });

    totalUploadedBytes += multerFile.size;
    results.push({ ...dbFile, uploadedByName });
  }

  // Increment org storage counter (ceil to avoid under-counting)
  if (orgId && totalUploadedBytes > 0) {
    const addedMb = Math.ceil(totalUploadedBytes / (1024 * 1024));
    await db
      .update(organizationsTable)
      .set({ storageUsedMb: sql`GREATEST(0, COALESCE(storage_used_mb, 0) + ${addedMb})`, updatedAt: new Date() })
      .where(eq(organizationsTable.id, orgId));
  }

  emitToUser(req.user!.id, "document:updated", { documentId: docId });
  res.status(201).json({ files: results });
});

// DELETE /api/projects/:projectId/documents/:id/files/:fileId
router.delete("/:id/files/:fileId", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const docId = paramInt(req.params.id);
  const fileId = paramInt(req.params.fileId);

  const [doc] = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, docId), eq(documentsTable.projectId, projectId)));
  if (!doc) res.status(404).json({ error: "Document not found" })
    return;

  const [file] = await db.select().from(documentFilesTable)
    .where(and(eq(documentFilesTable.id, fileId), eq(documentFilesTable.documentId, docId)));
  if (!file) res.status(404).json({ error: "File not found" })
    return;

  await db.delete(documentFilesTable).where(eq(documentFilesTable.id, fileId));

  await createAuditLog({
    userId: req.user!.id,
    action: "update",
    entityType: "document",
    entityId: docId,
    entityTitle: `${doc.title} — removed file: ${file.fileName}`,
    projectId,
  });

  // Decrement org storage counter (floor to avoid over-subtracting)
  const orgId = req.user!.organizationId;
  if (orgId && file.fileSize) {
    const removedMb = Math.floor(file.fileSize / (1024 * 1024));
    if (removedMb > 0) {
      await db
        .update(organizationsTable)
        .set({ storageUsedMb: sql`GREATEST(0, COALESCE(storage_used_mb, 0) - ${removedMb})`, updatedAt: new Date() })
        .where(eq(organizationsTable.id, orgId));
    }
  }

  res.status(204).end();
});

// ─── Lifecycle transitions: archive and obsolete ──────────────────────────────

router.patch("/:id/archive", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const caller = req.user!;
  const { reason } = req.body ?? {};

  if (!reason?.trim()) {
    res.status(400).json({ error: "A reason is required to archive a document" }); return;
  }
  if (!isSysAdmin(caller) && !["admin", "project_manager"].includes(caller.role)) {
    res.status(403).json({ error: "Only project managers and admins can archive documents" }); return;
  }

  const [doc] = await db.select({ id: documentsTable.id, title: documentsTable.title, documentNumber: documentsTable.documentNumber, status: documentsTable.status })
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .limit(1);
  if (!doc) { res.status(404).json({ error: "Not Found" }); return; }

  if (doc.status === "archived") {
    res.status(400).json({ error: "Document is already archived" }); return;
  }

  const [updated] = await db.update(documentsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "archive",
    entityType: "document",
    entityId: id,
    entityTitle: `${doc.documentNumber} — ${doc.title}`,
    projectId,
    details: { reason: reason.trim(), previousStatus: doc.status },
  });

  res.json(updated);
});

router.patch("/:id/obsolete", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  const id = paramInt(req.params.id);
  const caller = req.user!;
  const { reason, supersededByDocumentId } = req.body ?? {};

  if (!reason?.trim()) {
    res.status(400).json({ error: "A reason is required to mark a document obsolete" }); return;
  }
  if (!isSysAdmin(caller) && !["admin", "project_manager"].includes(caller.role)) {
    res.status(403).json({ error: "Only project managers and admins can mark documents obsolete" }); return;
  }

  const [doc] = await db.select({ id: documentsTable.id, title: documentsTable.title, documentNumber: documentsTable.documentNumber, status: documentsTable.status })
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.projectId, projectId)))
    .limit(1);
  if (!doc) { res.status(404).json({ error: "Not Found" }); return; }

  if (doc.status === "obsolete") {
    res.status(400).json({ error: "Document is already marked obsolete" }); return;
  }

  const [updated] = await db.update(documentsTable)
    .set({ status: "obsolete", updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "mark_obsolete",
    entityType: "document",
    entityId: id,
    entityTitle: `${doc.documentNumber} — ${doc.title}`,
    projectId,
    details: { reason: reason.trim(), previousStatus: doc.status, supersededByDocumentId: supersededByDocumentId ?? null },
  });

  res.json(updated);
});

// ─── Document Departments (Phase B — data layer, no enforcement) ──────────────

// GET  /api/projects/:projectId/documents/:id/departments
router.get("/:id/departments", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const rows = await db
    .select({
      id:           departmentsTable.id,
      code:         departmentsTable.code,
      name:         departmentsTable.name,
      assignedAt:   documentDepartmentsTable.assignedAt,
    })
    .from(documentDepartmentsTable)
    .innerJoin(departmentsTable, eq(departmentsTable.id, documentDepartmentsTable.departmentId))
    .where(eq(documentDepartmentsTable.documentId, id));
  res.json(rows);
});

// POST /api/projects/:projectId/documents/:id/departments  { departmentId }
router.post("/:id/departments", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const { departmentId } = req.body;
  if (!departmentId) { res.status(400).json({ error: "departmentId is required" }); return; }

  // Multi-tenant guard: department must belong to the same org as the project
  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [dept] = await db
    .select({ organizationId: departmentsTable.organizationId })
    .from(departmentsTable)
    .where(eq(departmentsTable.id, parseInt(departmentId)))
    .limit(1);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }

  if (dept.organizationId !== project.organizationId) {
    res.status(403).json({ error: "Department does not belong to this document's organization" }); return;
  }

  const [row] = await db
    .insert(documentDepartmentsTable)
    .values({ documentId: id, departmentId: parseInt(departmentId) })
    .onConflictDoNothing()
    .returning();
  res.status(201).json(row ?? { ok: true });
});

// DELETE /api/projects/:projectId/documents/:id/departments/:departmentId
router.delete("/:id/departments/:departmentId", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const departmentId = paramInt(req.params.departmentId);
  await db
    .delete(documentDepartmentsTable)
    .where(and(
      eq(documentDepartmentsTable.documentId, id),
      eq(documentDepartmentsTable.departmentId, departmentId),
    ));
  res.json({ ok: true });
});

export default router;
