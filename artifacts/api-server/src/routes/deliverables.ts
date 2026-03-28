import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { deliverablesTable, documentsTable, projectsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router({ mergeParams: true });

async function checkProjectOwnership(req: Request, res: Response, projectId: number): Promise<boolean> {
  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  // system_owner with no org restriction (no override active): allow all projects
  if (req.user!.role === "system_owner" && !req.user!.organizationId) return true;
  // All others (including system_owner with active org override): enforce org match
  if (project.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden", message: "Project does not belong to your organization" });
    return false;
  }
  return true;
}

router.get("/deliverables", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
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
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  const [row] = await db.select().from(deliverablesTable)
    .where(and(eq(deliverablesTable.id, parseInt(req.params.id)), eq(deliverablesTable.projectId, projectId)));
  if (!row) { res.status(404).json({ message: "Not found" }); return; }
  res.json(row);
});

router.post("/deliverables", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
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
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
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
    .where(and(eq(deliverablesTable.id, id), eq(deliverablesTable.projectId, projectId)))
    .returning();
  if (!row) { res.status(404).json({ message: "Not found" }); return; }
  res.json(row);
});

router.delete("/deliverables/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (!await checkProjectOwnership(req, res, projectId)) return;
  await db.delete(deliverablesTable).where(and(eq(deliverablesTable.id, parseInt(req.params.id)), eq(deliverablesTable.projectId, projectId)));
  res.json({ ok: true });
});

export default router;
