import { Router } from "express";
import { db } from "@workspace/db";
import { deliverablesTable, documentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router({ mergeParams: true });

router.get("/deliverables", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const rows = await db.select({
    d: deliverablesTable,
    doc: { documentNumber: documentsTable.documentNumber, title: documentsTable.title },
  })
    .from(deliverablesTable)
    .leftJoin(documentsTable, eq(deliverablesTable.linkedDocumentId, documentsTable.id))
    .where(eq(deliverablesTable.projectId, projectId))
    .orderBy(desc(deliverablesTable.createdAt));
  res.json({
    deliverables: rows.map(r => ({
      ...r.d,
      linkedDocumentNumber: r.doc?.documentNumber,
      linkedDocumentTitle: r.doc?.title,
    })),
  });
});

router.get("/deliverables/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ message: "Not found" }); return; }
  res.json(row);
});

router.post("/deliverables", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { deliverableId, title, type, plannedDate, actualDate, status, responsible, linkedDocumentId, remarks } = req.body;
  if (!title) { res.status(400).json({ message: "title is required" }); return; }
  const [row] = await db.insert(deliverablesTable).values({
    deliverableId: deliverableId || `DEL-${Date.now()}`,
    title, type,
    plannedDate: plannedDate ? new Date(plannedDate) : undefined,
    actualDate: actualDate ? new Date(actualDate) : undefined,
    status: status ?? "not_started",
    responsible,
    linkedDocumentId: linkedDocumentId ? parseInt(linkedDocumentId) : undefined,
    remarks,
    projectId,
    createdById: req.user!.id,
  }).returning();
  res.status(201).json(row);
});

router.put("/deliverables/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, type, plannedDate, actualDate, status, responsible, linkedDocumentId, remarks } = req.body;
  const [row] = await db.update(deliverablesTable)
    .set({
      title, type,
      plannedDate: plannedDate ? new Date(plannedDate) : undefined,
      actualDate: actualDate ? new Date(actualDate) : undefined,
      status, responsible,
      linkedDocumentId: linkedDocumentId ? parseInt(linkedDocumentId) : undefined,
      remarks,
      updatedAt: new Date(),
    })
    .where(eq(deliverablesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ message: "Not found" }); return; }
  res.json(row);
});

router.delete("/deliverables/:id", requireAuth, async (req, res) => {
  await db.delete(deliverablesTable).where(eq(deliverablesTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

export default router;
