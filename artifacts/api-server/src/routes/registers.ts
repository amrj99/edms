import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  projectsTable, usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { applyDocumentReviewDecision, isValidReviewDecision, type ReviewDecision } from "../lib/document-review.js";
import { sendRecordSubmittedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { getProjectRecipientsByRole } from "../lib/notifications/recipients.js";
import { param, paramInt, paramIntOrNull, type ProjectParams, type ProjectItemParams } from '../lib/params';

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
router.get("/inspection-requests", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(inspectionRequestsTable)
    .where(eq(inspectionRequestsTable.projectId, projectId))
    .orderBy(desc(inspectionRequestsTable.createdAt));
  res.json({ inspectionRequests: rows });
});

router.post("/inspection-requests", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { requestNumber, type, description, location, date, status, contractor, linkedCorrespondenceId, remarks, direction, partyType, reviewCode } = req.body;
  if (!requestNumber) { res.status(400).json({ error: "requestNumber is required" }); return; }
  let resolvedStatus = status ?? "pending";
  if (reviewCode === "A" || reviewCode === "B") resolvedStatus = "passed";
  else if (reviewCode === "C") resolvedStatus = "in_progress";
  else if (reviewCode === "D") resolvedStatus = "failed";
  const [row] = await db.insert(inspectionRequestsTable).values({
    requestNumber, type: type ?? "itr", description, location,
    date: date ? new Date(date) : undefined,
    status: resolvedStatus, contractor, linkedCorrespondenceId, remarks,
    direction: direction ?? null, partyType: partyType ?? null, reviewCode: reviewCode ?? null,
    organizationId: req.user!.organizationId ?? null,
    projectId, createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/inspection-requests/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { description, location, date, status, contractor, remarks, direction, partyType, reviewCode } = req.body;
  let resolvedStatus = status;
  if (reviewCode !== undefined && reviewCode !== null) {
    if (reviewCode === "A" || reviewCode === "B") resolvedStatus = "passed";
    else if (reviewCode === "C") resolvedStatus = "in_progress";
    else if (reviewCode === "D") resolvedStatus = "failed";
  }
  const [row] = await db.update(inspectionRequestsTable)
    .set({ description, location, date: date ? new Date(date) : undefined, status: resolvedStatus, contractor, remarks, direction, partyType, reviewCode, updatedAt: new Date() })
    .where(and(eq(inspectionRequestsTable.id, id), eq(inspectionRequestsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/inspection-requests/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(inspectionRequestsTable).where(and(eq(inspectionRequestsTable.id, paramInt(req.params.id)), eq(inspectionRequestsTable.projectId, projectId)));
  res.json({ ok: true });
});

// ITR — Workflow approval endpoints
router.post(
  "/inspection-requests/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
    const itrSubmitterId = req.user!.id;
    getProjectRecipientsByRole(projectId, ["admin", "project_manager"]).then(async recipients => {
      if (!recipients.length) return;
      const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
      const [submitter] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, itrSubmitterId)).limit(1);
      return dispatchNotification({
        event: "itr_submitted",
        recipients,
        sendEmail: (to) => sendRecordSubmittedEmail({
          to,
          recordType: "ITR",
          recordNumber: row.requestNumber,
          submittedByName: submitter ? `${submitter.firstName} ${submitter.lastName}`.trim() : "Someone",
          projectName: project?.name ?? "Unknown Project",
          description: row.description ?? undefined,
          projectId,
        }),
      });
    }).catch(() => {});
    res.json(row);
  }
);

router.post(
  "/inspection-requests/:id/approve",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
router.get("/ncr-records", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(ncrRecordsTable)
    .where(eq(ncrRecordsTable.projectId, projectId))
    .orderBy(desc(ncrRecordsTable.createdAt));
  res.json({ ncrRecords: rows });
});

router.post("/ncr-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { reportNumber, type, description, location, raisedBy, status, correctiveAction, closeDate, remarks, direction, partyType, reviewCode } = req.body;
  if (!reportNumber) { res.status(400).json({ error: "reportNumber is required" }); return; }
  let resolvedStatus = status ?? "open";
  if (reviewCode === "A") resolvedStatus = "closed";
  else if (reviewCode === "B") { resolvedStatus = "in_progress"; }
  const [row] = await db.insert(ncrRecordsTable).values({
    reportNumber, type: type ?? "ncr", description, location, raisedBy,
    status: resolvedStatus, correctiveAction,
    closeDate: closeDate ? new Date(closeDate) : undefined,
    remarks, direction: direction ?? null, partyType: partyType ?? null, reviewCode: reviewCode ?? null,
    organizationId: req.user!.organizationId ?? null,
    projectId, createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/ncr-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { description, location, raisedBy, status, correctiveAction, closeDate, remarks, direction, partyType, reviewCode } = req.body;
  let resolvedStatus = status;
  if (reviewCode !== undefined && reviewCode !== null) {
    if (reviewCode === "A") resolvedStatus = "closed";
    else if (reviewCode === "B") resolvedStatus = "in_progress";
  }
  const [row] = await db.update(ncrRecordsTable)
    .set({ description, location, raisedBy, status: resolvedStatus, correctiveAction, closeDate: closeDate ? new Date(closeDate) : undefined, remarks, direction, partyType, reviewCode, updatedAt: new Date() })
    .where(and(eq(ncrRecordsTable.id, id), eq(ncrRecordsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/ncr-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(ncrRecordsTable).where(and(eq(ncrRecordsTable.id, paramInt(req.params.id)), eq(ncrRecordsTable.projectId, projectId)));
  res.json({ ok: true });
});

// NCR — Workflow approval endpoints
router.post(
  "/ncr-records/:id/submit-approval",
  requireAuth,
  requireRole("admin", "project_manager", "document_controller"),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
    const ncrSubmitterId = req.user!.id;
    getProjectRecipientsByRole(projectId, ["admin", "project_manager"]).then(async recipients => {
      if (!recipients.length) return;
      const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
      const [submitter] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, ncrSubmitterId)).limit(1);
      return dispatchNotification({
        event: "ncr_submitted",
        recipients,
        sendEmail: (to) => sendRecordSubmittedEmail({
          to,
          recordType: "NCR",
          recordNumber: row.reportNumber,
          submittedByName: submitter ? `${submitter.firstName} ${submitter.lastName}`.trim() : "Someone",
          projectName: project?.name ?? "Unknown Project",
          description: row.description ?? undefined,
          projectId,
        }),
      });
    }).catch(() => {});
    res.json(row);
  }
);

router.post(
  "/ncr-records/:id/approve",
  requireAuth,
  requireRole("admin", "project_manager"),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const id = paramInt(req.params.id);
    const projectId = paramInt(req.params.projectId);
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
router.get("/noc-records", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const rows = await db.select().from(nocRecordsTable)
    .where(eq(nocRecordsTable.projectId, projectId))
    .orderBy(desc(nocRecordsTable.createdAt));
  res.json({ nocRecords: rows });
});

router.post("/noc-records", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { nocNumber, authority, date, status, linkedDocumentId, remarks, direction, partyType } = req.body;
  if (!nocNumber) { res.status(400).json({ error: "nocNumber is required" }); return; }
  const [row] = await db.insert(nocRecordsTable).values({
    nocNumber, authority,
    date: date ? new Date(date) : undefined,
    status: status ?? "pending", linkedDocumentId, remarks,
    direction: direction ?? null, partyType: partyType ?? null,
    organizationId: req.user!.organizationId ?? null,
    projectId, createdById: req.user!.id,
  }).returning();
  const nocCreatorId = req.user!.id;
  getProjectRecipientsByRole(projectId, ["admin", "project_manager"]).then(async recipients => {
    if (!recipients.length) return;
    const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    const [creator] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, nocCreatorId)).limit(1);
    return dispatchNotification({
      event: "noc_submitted",
      recipients,
      sendEmail: (to) => sendRecordSubmittedEmail({
        to,
        recordType: "NOC",
        recordNumber: nocNumber,
        submittedByName: creator ? `${creator.firstName} ${creator.lastName}`.trim() : "Someone",
        projectName: project?.name ?? "Unknown Project",
        description: remarks ?? undefined,
        projectId,
      }),
    });
  }).catch(() => {});
  res.status(201).json(row);
});

router.put("/noc-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const { authority, date, status, linkedDocumentId, remarks, direction, partyType } = req.body;
  const [row] = await db.update(nocRecordsTable)
    .set({ authority, date: date ? new Date(date) : undefined, status, linkedDocumentId, remarks, direction, partyType, updatedAt: new Date() })
    .where(and(eq(nocRecordsTable.id, id), eq(nocRecordsTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/noc-records/:id", requireAuth, requireRole("admin", "project_manager", "document_controller"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = paramInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(nocRecordsTable).where(and(eq(nocRecordsTable.id, paramInt(req.params.id)), eq(nocRecordsTable.projectId, projectId)));
  res.json({ ok: true });
});

export default router;
