import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, documentFilesTable, documentRevisionsTable, foldersTable, usersTable, projectsTable, projectMembersTable, documentDepartmentsTable, departmentsTable } from "@workspace/db";
import { eq, desc, asc, and, or, ilike, inArray, count, gte, lte, type SQL } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { shadowEvaluate, resolveAndEnforce, resolveListAndEnforce } from "../lib/access-resolver.js";
import {param, paramInt, requireInt} from '../lib/params';

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
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { projectId, discipline, documentType, status, source, issuedBy, search, page, limit, dateFrom, dateTo, projectName } = req.query;
  const lim = Math.min(parseInt(limit as string || "100"), 500);
  const pg  = Math.max(1, parseInt(page as string || "1"));

  const user = req.user!;

  const allowedProjectIds = await getAllowedProjectIds(
    user.id,
    user.organizationId ?? 0,
    isSysAdmin(user),
  );

  if (!allowedProjectIds.length) {
    res.json({ documents: [], total: 0, page: pg, totalPages: 0, limit: lim, hasMore: false });
    return;
  }

  // ── Build SQL WHERE conditions ──────────────────────────────────────────────
  const conds: SQL[] = [inArray(documentsTable.projectId, allowedProjectIds)];

  if (projectId) {
    const pid = parseInt(projectId as string);
    if (!isNaN(pid)) conds.push(eq(documentsTable.projectId, pid));
  }
  if (discipline)   conds.push(eq(documentsTable.discipline,   discipline as string));
  if (documentType) conds.push(eq(documentsTable.documentType, documentType as string));
  if (status)       conds.push(eq(documentsTable.status,       status as any));
  if (source)       conds.push(eq(documentsTable.source,       source as string));
  if (issuedBy) {
    const c = ilike(documentsTable.issuedBy, `%${issuedBy}%`);
    if (c) conds.push(c);
  }
  if (search && typeof search === "string" && search.trim()) {
    const s = search.trim();
    const c = or(
      ilike(documentsTable.documentNumber, `%${s}%`),
      ilike(documentsTable.title,          `%${s}%`),
      ilike(documentsTable.discipline,     `%${s}%`),
      ilike(documentsTable.documentType,   `%${s}%`),
      ilike(documentsTable.issuedBy,       `%${s}%`),
    );
    if (c) conds.push(c);
  }
  if (dateFrom) {
    const from = new Date(dateFrom as string);
    if (!isNaN(from.getTime())) conds.push(gte(documentsTable.updatedAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo as string);
    if (!isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      conds.push(lte(documentsTable.updatedAt, to));
    }
  }
  // projectName filter requires a JOIN — handled via subquery on project name
  if (projectName) {
    const matchingProjects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(or(
        ilike(projectsTable.name, `%${projectName}%`),
        ilike(projectsTable.code, `%${projectName}%`),
      ));
    const ids = matchingProjects.map(p => p.id);
    if (!ids.length) {
      res.json({ documents: [], total: 0, page: pg, totalPages: 0, limit: lim, hasMore: false });
      return;
    }
    conds.push(inArray(documentsTable.projectId, ids));
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  const SORT_MAP: Record<string, any> = {
    documentNumber: documentsTable.documentNumber,
    title:          documentsTable.title,
    revision:       documentsTable.revision,
    discipline:     documentsTable.discipline,
    documentType:   documentsTable.documentType,
    status:         documentsTable.status,
    issuedBy:       documentsTable.issuedBy,
    updatedAt:      documentsTable.updatedAt,
    createdAt:      documentsTable.createdAt,
  };
  const sortCol = SORT_MAP[(req.query.sortBy as string) ?? ""] ?? documentsTable.updatedAt;
  const orderFn = (req.query.sortOrder as string) === "asc" ? asc : desc;

  // ── Parallel: total count + paginated rows ──────────────────────────────────
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      doc:       documentsTable,
      createdBy: usersTable,
      folder:    foldersTable,
      project:   projectsTable,
    })
      .from(documentsTable)
      .leftJoin(usersTable,   eq(documentsTable.createdById, usersTable.id))
      .leftJoin(foldersTable, eq(documentsTable.folderId,    foldersTable.id))
      .leftJoin(projectsTable, eq(documentsTable.projectId,  projectsTable.id))
      .where(and(...conds))
      .orderBy(orderFn(sortCol))
      .limit(lim)
      .offset((pg - 1) * lim),

    db.select({ total: count() })
      .from(documentsTable)
      .where(and(...conds)),
  ]);

  // Shadow enforcement (default: no denials; does not affect counts)
  const { deniedDocIds } = await resolveListAndEnforce({
    userId:   user.id,
    userRole: user.role,
    documents: rows.map(({ doc }) => ({
      id:             doc.id,
      projectId:      doc.projectId,
      isConfidential: doc.isConfidential ?? false,
    })),
    endpoint: "GET /api/documents",
  });

  const finalRows = deniedDocIds.size > 0
    ? rows.filter(d => !deniedDocIds.has(d.doc.id))
    : rows;

  const totalCount = total ?? 0;
  const totalPages = Math.ceil(totalCount / lim);

  res.json({
    documents: finalRows.map(({ doc, createdBy, folder, project }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName:   folder?.name,
      projectName:  project?.name,
      projectCode:  project?.code,
    })),
    total:      totalCount,
    page:       pg,
    totalPages,
    limit:      lim,
    hasMore:    pg < totalPages,
  });
});

// GET /api/documents/:id — single document (org + project-membership scoped)
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
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

router.get("/:id/revisions", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
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
