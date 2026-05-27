import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, documentFilesTable, documentRevisionsTable, foldersTable, usersTable, projectsTable, projectMembersTable, documentDepartmentsTable, departmentsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { shadowEvaluate, resolveAndEnforce, resolveListAndEnforce } from "../lib/access-resolver.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();

/**
 * Resolve the set of project IDs a user is allowed to see documents from.
 *
 * Rules (enforced server-side):
 *  - system_owner → all projects in their organisation (platform-wide admin bypass)
 *  - Everyone else → only projects where they appear in project_members
 *
 * In both cases the org boundary is always enforced: projects from other
 * organisations are never included.
 */
async function getAllowedProjectIds(userId: number, organizationId: number, sysAdmin: boolean): Promise<number[]> {
  if (sysAdmin) {
    const rows = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, organizationId));
    return rows.map(r => r.id);
  }

  // Regular users: only projects they are explicitly a member of, within their org
  const rows = await db
    .select({ projectId: projectMembersTable.projectId })
    .from(projectMembersTable)
    .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(
      and(
        eq(projectMembersTable.userId, userId),
        eq(projectsTable.organizationId, organizationId),
      ),
    );
  return rows.map(r => r.projectId);
}

// GET /api/documents — documents visible to the authenticated user
// Scoped to: user's org AND projects the user is a member of (sys_owner bypasses)
router.get("/", requireAuth, async (req, res) => {
  const { projectId, discipline, documentType, status, source, issuedBy, search, page, limit, dateFrom, dateTo, projectName } = req.query;
  const lim = Math.min(parseInt(limit as string || "100"), 500);
  const pg = Math.max(1, parseInt(page as string || "1"));

  const user = req.user!;

  const allowedProjectIds = await getAllowedProjectIds(
    user.id,
    user.organizationId,
    isSysAdmin(user),
  );

  // User has no accessible projects → return empty immediately
  if (!allowedProjectIds.length) {
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

  // Primary security filter: restrict to allowed projects
  // Documents without a projectId (org-level only) are shown only if the org matches
  let filtered = docs.filter(d => {
    if (d.doc.projectId) return allowedProjectIds.includes(d.doc.projectId);
    return d.doc.organizationId === user.organizationId;
  });

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
  if (dateFrom) {
    const from = new Date(dateFrom as string);
    if (!isNaN(from.getTime())) {
      filtered = filtered.filter(d => new Date(d.doc.updatedAt) >= from);
    }
  }
  if (dateTo) {
    const to = new Date(dateTo as string);
    if (!isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(d => new Date(d.doc.updatedAt) <= to);
    }
  }
  if (projectName) {
    const pn = (projectName as string).toLowerCase();
    filtered = filtered.filter(d =>
      d.project?.name?.toLowerCase().includes(pn) ||
      d.project?.code?.toLowerCase().includes(pn)
    );
  }

  // Department enforcement gate — must run on ALL filtered docs before pagination so that
  // total counts are correct after denied documents are removed.
  // When PHASE_D_ENFORCE_DEPT=false (default): fires shadow logging async, returns no denials.
  // When PHASE_D_ENFORCE_DEPT=true: awaits batch evaluation, returns denied doc IDs to filter.
  const { deniedDocIds } = await resolveListAndEnforce({
    userId:    user.id,
    userRole:  user.role,
    documents: filtered.map(({ doc }) => ({
      id:             doc.id,
      projectId:      doc.projectId,
      isConfidential: doc.isConfidential ?? false,
    })),
    endpoint: "GET /api/documents",
  });
  if (deniedDocIds.size > 0) {
    filtered = filtered.filter(d => !deniedDocIds.has(d.doc.id));
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

// GET /api/documents/:id — single document (org + project-membership scoped)
router.get("/:id", requireAuth, async (req, res) => {
  const id = paramInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid document ID" }); return; }

  const user = req.user!;

  const [result] = await db.select({
    doc: documentsTable,
    project: projectsTable,
    createdBy: usersTable,
    folder: foldersTable,
  })
    .from(documentsTable)
    .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
    .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
    .where(eq(documentsTable.id, id))
    .limit(1);

  if (!result) { res.status(404).json({ error: "Document not found" }); return; }

  // Org boundary check (system_owner bypasses all below; org admins are still org-scoped)
  if (!isSystemOwner(user)) {
    if (result.project?.organizationId !== user.organizationId) {
      // Shadow resolver — system denied (cross-org boundary). Pass org IDs so resolver
      // can now correctly agree: cross-org admin_bypass no longer fires.
      void shadowEvaluate(
        {
          userId: user.id, userRole: user.role, documentId: id,
          projectId: result.doc.projectId ?? null,
          isConfidential: result.doc.isConfidential ?? false,
          userOrgId:     user.organizationId,
          documentOrgId: result.project?.organizationId,
        },
        false,
      );
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Project membership check: user must be a member of the document's project
    if (result.doc.projectId) {
      const [membership] = await db
        .select({ id: projectMembersTable.id })
        .from(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.projectId, result.doc.projectId),
            eq(projectMembersTable.userId, user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        // Shadow resolver — system denied (not a project member)
        void shadowEvaluate(
          {
            userId: user.id, userRole: user.role, documentId: id,
            projectId: result.doc.projectId,
            isConfidential: result.doc.isConfidential ?? false,
            userOrgId:     user.organizationId,
            documentOrgId: result.project?.organizationId,
          },
          false,
        );
        res.status(403).json({ error: "Forbidden: not a member of this project" }); return;
      }
    }
  }

  // Resolver + enforcement gate — system allowed this access.
  // resolveAndEnforce() handles shadow logging AND enforcement (enforcement off by default).
  const { enforcedDeny } = await resolveAndEnforce(
    {
      userId: user.id, userRole: user.role, documentId: id,
      projectId: result.doc.projectId ?? null,
      isConfidential: result.doc.isConfidential ?? false,
      userOrgId:     user.organizationId,
      documentOrgId: result.project?.organizationId,
    },
    true,
  );
  if (enforcedDeny) { res.status(403).json({ error: "Forbidden" }); return; }

  // Fetch attached files
  const files = await db.select({ file: documentFilesTable, uploader: usersTable })
    .from(documentFilesTable)
    .leftJoin(usersTable, eq(documentFilesTable.uploadedById, usersTable.id))
    .where(eq(documentFilesTable.documentId, id))
    .orderBy(desc(documentFilesTable.createdAt));

  // Fetch departments (Phase B — data only, no enforcement)
  const deptRows = await db
    .select({ id: departmentsTable.id, code: departmentsTable.code, name: departmentsTable.name })
    .from(documentDepartmentsTable)
    .innerJoin(departmentsTable, eq(departmentsTable.id, documentDepartmentsTable.departmentId))
    .where(eq(documentDepartmentsTable.documentId, id));

  res.json({
    ...result.doc,
    projectName: result.project?.name,
    projectCode: result.project?.code,
    folderName: result.folder?.name,
    createdByName: result.createdBy
      ? `${result.createdBy.firstName} ${result.createdBy.lastName}`
      : undefined,
    files: files.map(({ file, uploader }) => ({
      ...file,
      uploaderName: uploader ? `${uploader.firstName} ${uploader.lastName}` : undefined,
    })),
    departments: deptRows,
  });
});

// ─── Revisions ────────────────────────────────────────────────────────────────

router.get("/:id/revisions", requireAuth, async (req, res) => {
  const id = paramInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid document id" }); return; }

  const revisions = await db.select({
    rev:  documentRevisionsTable,
    user: usersTable,
  })
    .from(documentRevisionsTable)
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

export default router;
