import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  projectsTable, usersTable, documentsTable, transmittalsTable,
  transmittalItemsTable, registerColumnConfigTable,
} from "@workspace/db";
import { eq, and, desc, ilike, or, asc, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";

const router = Router({ mergeParams: true });

async function checkProjectOwnership(req: Request, res: Response, projectId: number): Promise<boolean> {
  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  // system_owner or admin with no org restriction: allow all projects
  if (!req.user!.organizationId && (req.user!.role === "system_owner" || req.user!.role === "admin")) return true;
  // All others: enforce org match
  if (project.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden", message: "Project does not belong to your organization" });
    return false;
  }
  return true;
}

// ─── ITR / MIR ────────────────────────────────────────────────────────────────
router.get("/inspection-requests", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(inspectionRequestsTable)
    .where(eq(inspectionRequestsTable.projectId, projectId))
    .orderBy(desc(inspectionRequestsTable.createdAt));
  res.json({ inspectionRequests: rows });
});

router.post("/inspection-requests", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { requestNumber, type, description, location, date, status, contractor, linkedCorrespondenceId, remarks } = req.body;
  if (!requestNumber) { res.status(400).json({ message: "requestNumber is required" }); return; }
  const [row] = await db.insert(inspectionRequestsTable).values({
    requestNumber, type: type ?? "itr", description, location,
    date: date ? new Date(date) : undefined,
    status: status ?? "pending", contractor, linkedCorrespondenceId, remarks,
    projectId, createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/inspection-requests/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { description, location, date, status, contractor, remarks } = req.body;
  const [row] = await db.update(inspectionRequestsTable)
    .set({ description, location, date: date ? new Date(date) : undefined, status, contractor, remarks, updatedAt: new Date() })
    .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/inspection-requests/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(inspectionRequestsTable).where(and(eq(inspectionRequestsTable.id, parseInt(req.params.id)), eq(inspectionRequestsTable.projectId, projectId)));
  res.json({ ok: true });
});

// ITR — Workflow approval endpoints
router.post(
  "/inspection-requests/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const [existing] = await db.select().from(inspectionRequestsTable)
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db.update(inspectionRequestsTable)
      .set({ approvalStatus: "pending", approvedById: null, approvalComment: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)))
      .returning();
    await createAuditLog({
      userId: req.user!.id, action: "approval_submitted", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
    });
    res.json(row);
  }
);

router.post(
  "/inspection-requests/:id/approve",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const { comment, decision: rawDecision } = req.body;
    const decision: ReviewDecision = isValidReviewDecision(rawDecision) ? rawDecision : "approved";

    const [existing] = await db.select().from(inspectionRequestsTable)
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to approve" }); return; }

    const [row] = await db.update(inspectionRequestsTable)
      .set({
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)))
      .returning();

    if (existing.linkedDocumentId) {
      const reviewer = req.user as any;
      const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;
      await applyDocumentReviewDecision({
        documentId: existing.linkedDocumentId,
        decision,
        reviewerId: req.user!.id,
        reviewerName,
        comment,
      });
    }

    await createAuditLog({
      userId: req.user!.id, action: "record_approved", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
      details: { comment, decision },
    });
    res.json(row);
  }
);

router.post(
  "/inspection-requests/:id/reject",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const { comment, decision: rawDecision } = req.body;
    const decision: ReviewDecision =
      (rawDecision === "rejected" || rawDecision === "for_revision") ? rawDecision : "for_revision";

    const [existing] = await db.select().from(inspectionRequestsTable)
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to reject" }); return; }

    const [row] = await db.update(inspectionRequestsTable)
      .set({
        approvalStatus: "rejected",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)))
      .returning();

    if (existing.linkedDocumentId) {
      const reviewer = req.user as any;
      const reviewerName = `${reviewer.firstName} ${reviewer.lastName}`;
      await applyDocumentReviewDecision({
        documentId: existing.linkedDocumentId,
        decision,
        reviewerId: req.user!.id,
        reviewerName,
        comment,
      });
    }

    await createAuditLog({
      userId: req.user!.id, action: "record_rejected", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
      details: { comment, decision },
    });
    res.json(row);
  }
);

// ─── NCR / SOR ────────────────────────────────────────────────────────────────
router.get("/ncr-records", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(ncrRecordsTable)
    .where(eq(ncrRecordsTable.projectId, projectId))
    .orderBy(desc(ncrRecordsTable.createdAt));
  res.json({ ncrRecords: rows });
});

router.post("/ncr-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { reportNumber, type, description, location, raisedBy, status, correctiveAction, closeDate, remarks } = req.body;
  if (!reportNumber) { res.status(400).json({ message: "reportNumber is required" }); return; }
  const [row] = await db.insert(ncrRecordsTable).values({
    reportNumber, type: type ?? "ncr", description, location, raisedBy,
    status: status ?? "open", correctiveAction,
    closeDate: closeDate ? new Date(closeDate) : undefined,
    remarks, projectId, createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/ncr-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { description, location, raisedBy, status, correctiveAction, closeDate, remarks } = req.body;
  const [row] = await db.update(ncrRecordsTable)
    .set({ description, location, raisedBy, status, correctiveAction, closeDate: closeDate ? new Date(closeDate) : undefined, remarks, updatedAt: new Date() })
    .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/ncr-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(ncrRecordsTable).where(and(eq(ncrRecordsTable.id, parseInt(req.params.id)), eq(ncrRecordsTable.projectId, projectId)));
  res.json({ ok: true });
});

// NCR — Workflow approval endpoints
router.post(
  "/ncr-records/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const [existing] = await db.select().from(ncrRecordsTable)
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db.update(ncrRecordsTable)
      .set({ approvalStatus: "pending", approvedById: null, approvalComment: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)))
      .returning();
    await createAuditLog({
      userId: req.user!.id, action: "approval_submitted", entityType: "ncr",
      entityId: id, entityTitle: row.reportNumber, projectId: row.projectId,
    });
    res.json(row);
  }
);

router.post(
  "/ncr-records/:id/approve",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const { comment } = req.body;
    const [existing] = await db.select().from(ncrRecordsTable)
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to approve" }); return; }
    const [row] = await db.update(ncrRecordsTable)
      .set({
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)))
      .returning();
    await createAuditLog({
      userId: req.user!.id, action: "record_approved", entityType: "ncr",
      entityId: id, entityTitle: row.reportNumber, projectId: row.projectId,
      details: { comment },
    });
    res.json(row);
  }
);

router.post(
  "/ncr-records/:id/reject",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);
    if (!await checkProjectOwnership(req, res, projectId)) return;
    const { comment } = req.body;
    const [existing] = await db.select().from(ncrRecordsTable)
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.approvalStatus !== "pending") { res.status(409).json({ error: "Record must be in pending state to reject" }); return; }
    const [row] = await db.update(ncrRecordsTable)
      .set({
        approvalStatus: "rejected",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)))
      .returning();
    await createAuditLog({
      userId: req.user!.id, action: "record_rejected", entityType: "ncr",
      entityId: id, entityTitle: row.reportNumber, projectId: row.projectId,
      details: { comment },
    });
    res.json(row);
  }
);

// ─── NOC ──────────────────────────────────────────────────────────────────────
router.get("/noc-records", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(nocRecordsTable)
    .where(eq(nocRecordsTable.projectId, projectId))
    .orderBy(desc(nocRecordsTable.createdAt));
  res.json({ nocRecords: rows });
});

router.post("/noc-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { nocNumber, authority, date, status, linkedDocumentId, remarks } = req.body;
  if (!nocNumber) { res.status(400).json({ message: "nocNumber is required" }); return; }
  const [row] = await db.insert(nocRecordsTable).values({
    nocNumber, authority,
    date: date ? new Date(date) : undefined,
    status: status ?? "pending", linkedDocumentId, remarks,
    projectId, createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/noc-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { authority, date, status, linkedDocumentId, remarks } = req.body;
  const [row] = await db.update(nocRecordsTable)
    .set({ authority, date: date ? new Date(date) : undefined, status, linkedDocumentId, remarks, updatedAt: new Date() })
    .where(and(eq(nocRecordsTable.id, id), eq(nocRecordsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/noc-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(nocRecordsTable).where(and(eq(nocRecordsTable.id, parseInt(req.params.id)), eq(nocRecordsTable.projectId, projectId)));
  res.json({ ok: true });
});

// ─── Register View Endpoints ───────────────────────────────────────────────────

// Default column configs per register type
const DOCUMENT_REGISTER_DEFAULTS = [
  { columnKey: "document_number", isVisible: true, displayOrder: 1 },
  { columnKey: "title", isVisible: true, displayOrder: 2 },
  { columnKey: "document_type", isVisible: true, displayOrder: 3 },
  { columnKey: "discipline", isVisible: true, displayOrder: 4 },
  { columnKey: "revision", isVisible: true, displayOrder: 5 },
  { columnKey: "status", isVisible: true, displayOrder: 6 },
  { columnKey: "party_type", isVisible: true, displayOrder: 7 },
  { columnKey: "issued_by", isVisible: true, displayOrder: 8 },
  { columnKey: "created_at", isVisible: true, displayOrder: 9 },
  { columnKey: "remarks", isVisible: false, displayOrder: 10 },
];

const DRAWING_REGISTER_DEFAULTS = [
  { columnKey: "document_number", isVisible: true, displayOrder: 1 },
  { columnKey: "title", isVisible: true, displayOrder: 2 },
  { columnKey: "drawing_type", isVisible: true, displayOrder: 3 },
  { columnKey: "discipline", isVisible: true, displayOrder: 4 },
  { columnKey: "revision", isVisible: true, displayOrder: 5 },
  { columnKey: "review_code", isVisible: true, displayOrder: 6 },
  { columnKey: "party_type", isVisible: true, displayOrder: 7 },
  { columnKey: "submission_date", isVisible: true, displayOrder: 8 },
  { columnKey: "response_date", isVisible: true, displayOrder: 9 },
  { columnKey: "transmittal_ref", isVisible: true, displayOrder: 10 },
  { columnKey: "area_location", isVisible: false, displayOrder: 11 },
  { columnKey: "itp_ref", isVisible: false, displayOrder: 12 },
];

const TRANSMITTAL_REGISTER_DEFAULTS = [
  { columnKey: "transmittal_number", isVisible: true, displayOrder: 1 },
  { columnKey: "subject", isVisible: true, displayOrder: 2 },
  { columnKey: "direction", isVisible: true, displayOrder: 3 },
  { columnKey: "party_type", isVisible: true, displayOrder: 4 },
  { columnKey: "status", isVisible: true, displayOrder: 5 },
  { columnKey: "purpose", isVisible: true, displayOrder: 6 },
  { columnKey: "sent_at", isVisible: true, displayOrder: 7 },
  { columnKey: "due_date", isVisible: true, displayOrder: 8 },
  { columnKey: "approval_status", isVisible: true, displayOrder: 9 },
  { columnKey: "items_count", isVisible: true, displayOrder: 10 },
  { columnKey: "review_code", isVisible: true, displayOrder: 11 },
  { columnKey: "remarks", isVisible: false, displayOrder: 12 },
];

const DEFAULTS_MAP: Record<string, typeof DOCUMENT_REGISTER_DEFAULTS> = {
  document: DOCUMENT_REGISTER_DEFAULTS,
  drawing: DRAWING_REGISTER_DEFAULTS,
  transmittal: TRANSMITTAL_REGISTER_DEFAULTS,
};

// GET Master Document Register
router.get("/registers/documents", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;

  const { partyType, discipline, status, search, page = "1", limit = "50" } = req.query as Record<string, string>;

  const conditions = [eq(documentsTable.projectId, projectId)];
  if (partyType) conditions.push(eq(documentsTable.partyType, partyType));
  if (discipline) conditions.push(eq(documentsTable.discipline, discipline));
  if (status) conditions.push(eq(documentsTable.status, status as any));
  if (search) conditions.push(or(
    ilike(documentsTable.documentNumber, `%${search}%`),
    ilike(documentsTable.title, `%${search}%`),
  )!);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const rows = await db
    .select({
      id: documentsTable.id,
      documentNumber: documentsTable.documentNumber,
      title: documentsTable.title,
      documentType: documentsTable.documentType,
      discipline: documentsTable.discipline,
      revision: documentsTable.revision,
      status: documentsTable.status,
      partyType: documentsTable.partyType,
      issuedBy: documentsTable.issuedBy,
      createdAt: documentsTable.createdAt,
      description: documentsTable.description,
    })
    .from(documentsTable)
    .where(and(...conditions))
    .orderBy(asc(documentsTable.documentNumber))
    .limit(parseInt(limit))
    .offset(offset);

  res.json({ documents: rows, page: parseInt(page), limit: parseInt(limit) });
});

// GET Drawings Register
router.get("/registers/drawings", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;

  const { partyType, discipline, drawingType, reviewCode, search, page = "1", limit = "50" } = req.query as Record<string, string>;

  const conditions = [
    eq(documentsTable.projectId, projectId),
    eq(documentsTable.documentType, "Drawing"),
  ];
  if (partyType) conditions.push(eq(documentsTable.partyType, partyType));
  if (discipline) conditions.push(eq(documentsTable.discipline, discipline));
  if (drawingType) conditions.push(eq(documentsTable.drawingType, drawingType));
  if (search) conditions.push(or(
    ilike(documentsTable.documentNumber, `%${search}%`),
    ilike(documentsTable.title, `%${search}%`),
  )!);

  const offset = (parseInt(page) - 1) * parseInt(limit);

  // For drawings, get the latest review code from transmittal items
  const docs = await db
    .select({
      id: documentsTable.id,
      documentNumber: documentsTable.documentNumber,
      title: documentsTable.title,
      drawingType: documentsTable.drawingType,
      discipline: documentsTable.discipline,
      revision: documentsTable.revision,
      status: documentsTable.status,
      partyType: documentsTable.partyType,
      createdAt: documentsTable.createdAt,
    })
    .from(documentsTable)
    .where(and(...conditions))
    .orderBy(asc(documentsTable.documentNumber))
    .limit(parseInt(limit))
    .offset(offset);

  // Enrich with latest transmittal info per document
  const docIds = docs.map(d => d.id);
  let transmittalInfo: Record<number, { reviewCode: string | null; transmittalNumber: string; sentAt: Date | null; reviewDate: Date | null }> = {};
  if (docIds.length > 0) {
    const { sql: sqlFn } = await import("drizzle-orm");
    const items = await db
      .select({
        documentId: transmittalItemsTable.documentId,
        reviewCode: transmittalItemsTable.reviewCode,
        reviewDate: transmittalItemsTable.reviewDate,
        transmittalNumber: transmittalsTable.transmittalNumber,
        sentAt: transmittalsTable.sentAt,
      })
      .from(transmittalItemsTable)
      .innerJoin(transmittalsTable, eq(transmittalItemsTable.transmittalId, transmittalsTable.id))
      .where(eq(transmittalsTable.projectId, projectId))
      .orderBy(desc(transmittalsTable.sentAt));

    for (const item of items) {
      if (docIds.includes(item.documentId) && !transmittalInfo[item.documentId]) {
        transmittalInfo[item.documentId] = {
          reviewCode: item.reviewCode,
          transmittalNumber: item.transmittalNumber,
          sentAt: item.sentAt,
          reviewDate: item.reviewDate,
        };
      }
    }
  }

  // Filter by reviewCode if requested (post-join)
  const result = docs
    .map(d => ({ ...d, ...transmittalInfo[d.id] }))
    .filter(d => !reviewCode || d.reviewCode === reviewCode);

  res.json({ drawings: result, page: parseInt(page), limit: parseInt(limit) });
});

// GET Transmittal Register
router.get("/registers/transmittals", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;

  const { direction, partyType, discipline, status, reviewCode, search, page = "1", limit = "50" } = req.query as Record<string, string>;

  const conditions = [eq(transmittalsTable.projectId, projectId)];
  if (direction) conditions.push(eq(transmittalsTable.direction, direction));
  if (partyType) conditions.push(eq(transmittalsTable.partyType, partyType));
  if (status) conditions.push(eq(transmittalsTable.status, status as any));
  if (search) conditions.push(or(
    ilike(transmittalsTable.transmittalNumber, `%${search}%`),
    ilike(transmittalsTable.subject, `%${search}%`),
  )!);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const rows = await db
    .select({
      id: transmittalsTable.id,
      transmittalNumber: transmittalsTable.transmittalNumber,
      subject: transmittalsTable.subject,
      direction: transmittalsTable.direction,
      partyType: transmittalsTable.partyType,
      status: transmittalsTable.status,
      purpose: transmittalsTable.purpose,
      sentAt: transmittalsTable.sentAt,
      dueDate: transmittalsTable.dueDate,
      approvalStatus: transmittalsTable.approvalStatus,
      toExternal: transmittalsTable.toExternal,
      createdAt: transmittalsTable.createdAt,
    })
    .from(transmittalsTable)
    .where(and(...conditions))
    .orderBy(desc(transmittalsTable.createdAt))
    .limit(parseInt(limit))
    .offset(offset);

  // Enrich each transmittal with item count + dominant review code
  const txIds = rows.map(r => r.id);
  let itemsMeta: Record<number, { count: number; reviewCodes: string[] }> = {};
  if (txIds.length > 0) {
    const items = await db
      .select({ transmittalId: transmittalItemsTable.transmittalId, reviewCode: transmittalItemsTable.reviewCode })
      .from(transmittalItemsTable)
      .where(and(...txIds.map(id => eq(transmittalItemsTable.transmittalId, id))));

    for (const item of items) {
      if (!itemsMeta[item.transmittalId]) itemsMeta[item.transmittalId] = { count: 0, reviewCodes: [] };
      itemsMeta[item.transmittalId].count++;
      if (item.reviewCode) itemsMeta[item.transmittalId].reviewCodes.push(item.reviewCode);
    }
  }

  let result = rows.map(r => ({
    ...r,
    itemsCount: itemsMeta[r.id]?.count ?? 0,
    reviewCodes: [...new Set(itemsMeta[r.id]?.reviewCodes ?? [])],
  }));

  // Filter by reviewCode post-join
  if (reviewCode) result = result.filter(r => r.reviewCodes.includes(reviewCode));

  res.json({ transmittals: result, page: parseInt(page), limit: parseInt(limit) });
});

// ─── Register Column Configuration ────────────────────────────────────────────

function resolveColumnConfig(
  defaults: { columnKey: string; isVisible: boolean; displayOrder: number }[],
  orgConfig: typeof registerColumnConfigTable.$inferSelect[],
  projectConfig: typeof registerColumnConfigTable.$inferSelect[],
) {
  const base = new Map(defaults.map(d => [d.columnKey, { ...d, columnLabel: null as string | null }]));
  // Apply org-level overrides
  for (const row of orgConfig) {
    if (base.has(row.columnKey)) {
      base.set(row.columnKey, { ...base.get(row.columnKey)!, isVisible: row.isVisible, displayOrder: row.displayOrder, columnLabel: row.columnLabel });
    }
  }
  // Apply project-level overrides
  for (const row of projectConfig) {
    if (base.has(row.columnKey)) {
      base.set(row.columnKey, { ...base.get(row.columnKey)!, isVisible: row.isVisible, displayOrder: row.displayOrder, columnLabel: row.columnLabel });
    }
  }
  return [...base.values()].sort((a, b) => a.displayOrder - b.displayOrder);
}

router.get("/register-config/:registerType", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { registerType } = req.params;
  if (!await checkProjectOwnership(req, res, projectId)) return;

  const [project] = await db.select({ organizationId: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const defaults = DEFAULTS_MAP[registerType] ?? DOCUMENT_REGISTER_DEFAULTS;

  const orgConfig = await db.select().from(registerColumnConfigTable)
    .where(and(
      eq(registerColumnConfigTable.organizationId, project.organizationId!),
      eq(registerColumnConfigTable.registerType, registerType),
      isNull(registerColumnConfigTable.projectId),
    ));

  const projectConfig = await db.select().from(registerColumnConfigTable)
    .where(and(
      eq(registerColumnConfigTable.projectId, projectId),
      eq(registerColumnConfigTable.registerType, registerType),
    ));

  const columns = resolveColumnConfig(defaults, orgConfig, projectConfig);
  res.json({ registerType, columns });
});

router.put("/register-config/:registerType", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { registerType } = req.params;
  if (!await checkProjectOwnership(req, res, projectId)) return;

  const [project] = await db.select({ organizationId: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const { columns, scope = "project" } = req.body as {
    columns: { columnKey: string; isVisible: boolean; displayOrder: number; columnLabel?: string }[];
    scope?: "project" | "org";
  };

  if (!Array.isArray(columns)) { res.status(400).json({ error: "columns must be an array" }); return; }

  const organizationId = project.organizationId!;

  // Delete existing config for this scope
  if (scope === "project") {
    await db.delete(registerColumnConfigTable)
      .where(and(eq(registerColumnConfigTable.projectId, projectId), eq(registerColumnConfigTable.registerType, registerType)));
  } else {
    await db.delete(registerColumnConfigTable)
      .where(and(
        eq(registerColumnConfigTable.organizationId, organizationId),
        eq(registerColumnConfigTable.registerType, registerType),
        isNull(registerColumnConfigTable.projectId),
      ));
  }

  // Insert new config
  if (columns.length > 0) {
    await db.insert(registerColumnConfigTable).values(
      columns.map(col => ({
        organizationId,
        projectId: scope === "project" ? projectId : null,
        registerType,
        columnKey: col.columnKey,
        isVisible: col.isVisible,
        displayOrder: col.displayOrder,
        columnLabel: col.columnLabel ?? null,
      }))
    );
  }

  res.json({ ok: true });
});

// Helper: seed default column config for a new project (called from projects route)
export async function seedRegisterDefaults(projectId: number, organizationId: number) {
  const entries = Object.entries(DEFAULTS_MAP).flatMap(([registerType, cols]) =>
    cols.map(col => ({
      organizationId,
      projectId,
      registerType,
      columnKey: col.columnKey,
      isVisible: col.isVisible,
      displayOrder: col.displayOrder,
    }))
  );
  // Only insert if no config exists yet
  const existing = await db.select({ id: registerColumnConfigTable.id })
    .from(registerColumnConfigTable)
    .where(eq(registerColumnConfigTable.projectId, projectId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(registerColumnConfigTable).values(entries);
  }
}

export default router;
