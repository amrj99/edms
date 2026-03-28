import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router({ mergeParams: true });

// ─── ITR / MIR ────────────────────────────────────────────────────────────────
router.get("/inspection-requests", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const rows = await db.select().from(inspectionRequestsTable)
    .where(eq(inspectionRequestsTable.projectId, projectId))
    .orderBy(desc(inspectionRequestsTable.createdAt));
  res.json({ inspectionRequests: rows });
});

router.post("/inspection-requests", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
  const { description, location, date, status, contractor, remarks } = req.body;
  const [row] = await db.update(inspectionRequestsTable)
    .set({ description, location, date: date ? new Date(date) : undefined, status, contractor, remarks, updatedAt: new Date() })
    .where(eq(inspectionRequestsTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/inspection-requests/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  await db.delete(inspectionRequestsTable).where(eq(inspectionRequestsTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

// ITR — Workflow approval endpoints
router.post(
  "/inspection-requests/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const [row] = await db.update(inspectionRequestsTable)
      .set({ approvalStatus: "pending", updatedAt: new Date() })
      .where(eq(inspectionRequestsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_submit", entityType: "itr",
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
    const { comment } = req.body;
    const [row] = await db.update(inspectionRequestsTable)
      .set({
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inspectionRequestsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_approve", entityType: "itr",
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
    const { comment } = req.body;
    const [row] = await db.update(inspectionRequestsTable)
      .set({
        approvalStatus: "rejected",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inspectionRequestsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_reject", entityType: "itr",
      entityId: id, entityTitle: row.requestNumber, projectId: row.projectId,
      details: { comment },
    });
    res.json(row);
  }
);

// ─── NCR / SOR ────────────────────────────────────────────────────────────────
router.get("/ncr-records", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const rows = await db.select().from(ncrRecordsTable)
    .where(eq(ncrRecordsTable.projectId, projectId))
    .orderBy(desc(ncrRecordsTable.createdAt));
  res.json({ ncrRecords: rows });
});

router.post("/ncr-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
  const { description, location, raisedBy, status, correctiveAction, closeDate, remarks } = req.body;
  const [row] = await db.update(ncrRecordsTable)
    .set({ description, location, raisedBy, status, correctiveAction, closeDate: closeDate ? new Date(closeDate) : undefined, remarks, updatedAt: new Date() })
    .where(eq(ncrRecordsTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/ncr-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  await db.delete(ncrRecordsTable).where(eq(ncrRecordsTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

// NCR — Workflow approval endpoints
router.post(
  "/ncr-records/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const [row] = await db.update(ncrRecordsTable)
      .set({ approvalStatus: "pending", updatedAt: new Date() })
      .where(eq(ncrRecordsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_submit", entityType: "ncr",
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
    const { comment } = req.body;
    const [row] = await db.update(ncrRecordsTable)
      .set({
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ncrRecordsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_approve", entityType: "ncr",
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
    const { comment } = req.body;
    const [row] = await db.update(ncrRecordsTable)
      .set({
        approvalStatus: "rejected",
        approvedById: req.user!.id,
        approvalComment: comment ?? null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ncrRecordsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await createAuditLog({
      userId: req.user!.id, action: "action_workflow_reject", entityType: "ncr",
      entityId: id, entityTitle: row.reportNumber, projectId: row.projectId,
      details: { comment },
    });
    res.json(row);
  }
);

// ─── NOC ──────────────────────────────────────────────────────────────────────
router.get("/noc-records", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const rows = await db.select().from(nocRecordsTable)
    .where(eq(nocRecordsTable.projectId, projectId))
    .orderBy(desc(nocRecordsTable.createdAt));
  res.json({ nocRecords: rows });
});

router.post("/noc-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
  const { authority, date, status, linkedDocumentId, remarks } = req.body;
  const [row] = await db.update(nocRecordsTable)
    .set({ authority, date: date ? new Date(date) : undefined, status, linkedDocumentId, remarks, updatedAt: new Date() })
    .where(eq(nocRecordsTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/noc-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  await db.delete(nocRecordsTable).where(eq(nocRecordsTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

export default router;
