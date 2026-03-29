import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

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
    const { comment } = req.body;
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
    await createAuditLog({
      userId: req.user!.id, action: "record_approved", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
      details: { comment },
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
    const { comment } = req.body;
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
    await createAuditLog({
      userId: req.user!.id, action: "record_rejected", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
      details: { comment },
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

export default router;
