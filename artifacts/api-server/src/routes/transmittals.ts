import { Router } from "express";
import { db } from "@workspace/db";
import {
  transmittalsTable, transmittalItemsTable, documentsTable, usersTable, projectsTable
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
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
      documentNumber: documentsTable.documentNumber,
      documentTitle: documentsTable.title,
      documentType: documentsTable.documentType,
      discipline: documentsTable.discipline,
    })
    .from(transmittalItemsTable)
    .leftJoin(documentsTable, eq(transmittalItemsTable.documentId, documentsTable.id))
    .where(eq(transmittalItemsTable.transmittalId, id));

  res.json({ ...transmittal, items });
});

// Create transmittal
router.post("/", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { subject, description, purpose, dueDate, toExternal, documentIds } = req.body;
  if (!subject) { res.status(400).json({ error: "Subject is required" }); return; }

  // Generate transmittal number
  const existing = await db
    .select({ count: transmittalsTable.id })
    .from(transmittalsTable)
    .where(eq(transmittalsTable.projectId, projectId));
  const seq = String(existing.length + 1).padStart(4, "0");
  const [project] = await db.select({ code: projectsTable.code }).from(projectsTable).where(eq(projectsTable.id, projectId));
  const transmittalNumber = `TRS-${project?.code ?? "PRJ"}-${seq}`;

  const [transmittal] = await db.insert(transmittalsTable).values({
    transmittalNumber,
    subject,
    description,
    purpose: purpose || "for_information",
    dueDate: dueDate ? new Date(dueDate) : undefined,
    toExternal,
    projectId,
    createdById: req.user!.id,
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
  const { subject, description, purpose, dueDate, toExternal, status } = req.body;
  const [transmittal] = await db.update(transmittalsTable)
    .set({ subject, description, purpose, dueDate: dueDate ? new Date(dueDate) : undefined, toExternal, status, updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id))
    .returning();
  res.json(transmittal);
});

// Send transmittal
router.post("/:id/send", requireRole("admin", "project_manager", "document_controller"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [transmittal] = await db.update(transmittalsTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id))
    .returning();
  await createAuditLog({
    userId: req.user!.id, action: "update", entityType: "transmittal",
    entityId: id, details: { action: "sent" },
  });
  res.json(transmittal);
});

// Acknowledge transmittal
router.post("/:id/acknowledge", async (req, res) => {
  const id = parseInt(req.params.id);
  const [transmittal] = await db.update(transmittalsTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(transmittalsTable.id, id))
    .returning();
  res.json(transmittal);
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
    const { comment } = req.body;
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
    await createAuditLog({
      userId: req.user!.id, action: "record_approved", entityType: "transmittal",
      entityId: id, entityTitle: row.transmittalNumber, projectId: row.projectId,
      details: { comment },
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
    const { comment } = req.body;
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
    await createAuditLog({
      userId: req.user!.id, action: "record_rejected", entityType: "transmittal",
      entityId: id, entityTitle: row.transmittalNumber, projectId: row.projectId,
      details: { comment },
    });
    res.json(row);
  }
);

export default router;
