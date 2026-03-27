import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, foldersTable, usersTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

// GET /api/documents — all documents visible to the authenticated user (scoped to their org)
router.get("/", requireAuth, async (req, res) => {
  const { projectId, discipline, documentType, status, source, issuedBy, search, page, limit } = req.query;
  const lim = Math.min(parseInt(limit as string || "100"), 500);
  const pg = Math.max(1, parseInt(page as string || "1"));

  // Fetch all projects the user can see (org-scoped)
  const orgProjects = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(eq(projectsTable.organizationId, req.user!.organizationId));
  const orgProjectIds = orgProjects.map(p => p.id);

  if (!orgProjectIds.length) {
    res.json({ documents: [], total: 0, page: pg, totalPages: 0 });
    return;
  }

  const docs = await db.select({
    doc: documentsTable,
    createdBy: usersTable,
    folder: foldersTable,
    project: projectsTable,
  }).from(documentsTable)
    .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
    .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
    .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
    .orderBy(desc(documentsTable.updatedAt));

  let filtered = docs.filter(d => orgProjectIds.includes(d.doc.projectId));

  if (projectId) filtered = filtered.filter(d => d.doc.projectId === parseInt(projectId as string));
  if (discipline) filtered = filtered.filter(d => d.doc.discipline === discipline);
  if (documentType) filtered = filtered.filter(d => d.doc.documentType === documentType);
  if (status) filtered = filtered.filter(d => d.doc.status === status);
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

  const total = filtered.length;
  const totalPages = Math.ceil(total / lim);
  const paginated = filtered.slice((pg - 1) * lim, pg * lim);

  res.json({
    documents: paginated.map(({ doc, createdBy, folder, project }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName: folder?.name,
      projectName: project?.name,
      projectCode: project?.code,
    })),
    total,
    page: pg,
    totalPages,
    limit: lim,
    hasMore: pg < totalPages,
  });
});

export default router;
