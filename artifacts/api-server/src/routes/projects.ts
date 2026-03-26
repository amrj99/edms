import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, organizationsTable, usersTable, documentsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const effectiveOrgId = isSysAdmin(user) && req.query.organizationId
    ? parseInt(req.query.organizationId as string)
    : user.organizationId;

  let query = db.select({
    project: projectsTable,
    orgName: organizationsTable.name,
  }).from(projectsTable).leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id));

  const projects = effectiveOrgId
    ? (await query).filter(p => p.project.organizationId === effectiveOrgId)
    : await query;

  const memberCounts = await db.select({ projectId: projectMembersTable.projectId, cnt: count() }).from(projectMembersTable).groupBy(projectMembersTable.projectId);
  const docCounts = await db.select({ projectId: documentsTable.projectId, cnt: count() }).from(documentsTable).groupBy(documentsTable.projectId);

  const mcMap = new Map(memberCounts.map(r => [r.projectId, Number(r.cnt)]));
  const dcMap = new Map(docCounts.map(r => [r.projectId, Number(r.cnt)]));

  res.json({
    projects: projects.map(({ project, orgName }) => ({
      ...project,
      organizationName: orgName,
      memberCount: mcMap.get(project.id) ?? 0,
      documentCount: dcMap.get(project.id) ?? 0,
    })),
    total: projects.length,
  });
});

router.post("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const { name, code, description, status, startDate, endDate } = req.body;
  const organizationId = isSysAdmin(user) && req.body.organizationId
    ? req.body.organizationId
    : user.organizationId;

  if (!name || !code || !organizationId) {
    res.status(400).json({ error: "Bad Request", message: "name, code, and an organization are required" });
    return;
  }
  const [project] = await db.insert(projectsTable).values({
    name, code, description, status: status || "active",
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    organizationId,
  }).returning();

  await db.insert(projectMembersTable).values({ projectId: project.id, userId: user.id, role: "admin" });
  await createAuditLog({ userId: user.id, action: "create", entityType: "project", entityId: project.id, entityTitle: project.name, projectId: project.id });
  res.status(201).json({ ...project, memberCount: 1, documentCount: 0 });
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const results = await db.select({ project: projectsTable, orgName: organizationsTable.name })
    .from(projectsTable)
    .leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(eq(projectsTable.id, id))
    .limit(1);

  if (!results[0]) { res.status(404).json({ error: "Not Found" }); return; }

  if (!isSysAdmin(user) && results[0].project.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const mc = await db.select({ cnt: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, id));
  const dc = await db.select({ cnt: count() }).from(documentsTable).where(eq(documentsTable.projectId, id));
  res.json({ ...results[0].project, organizationName: results[0].orgName, memberCount: Number(mc[0]?.cnt ?? 0), documentCount: Number(dc[0]?.cnt ?? 0) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }
  if (!isSysAdmin(user) && existing.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { name, code, description, status, startDate, endDate } = req.body;
  const organizationId = isSysAdmin(user) && req.body.organizationId ? req.body.organizationId : existing.organizationId;

  const [project] = await db.update(projectsTable)
    .set({ name, code, description, status, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined, organizationId, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning();
  res.json({ ...project, memberCount: 0, documentCount: 0 });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }
  if (!isSysAdmin(user) && existing.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
});

// Members
router.get("/:id/members", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const members = await db.select({
    member: projectMembersTable,
    user: usersTable,
  }).from(projectMembersTable)
    .leftJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, id));

  res.json({
    members: members.map(({ member, user }) => ({
      id: member.id,
      userId: member.userId,
      projectId: member.projectId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: user ? {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive, organizationId: user.organizationId, createdAt: user.createdAt,
      } : undefined,
    })),
    total: members.length,
  });
});

router.post("/:id/members", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { userId, role } = req.body;
  const [member] = await db.insert(projectMembersTable).values({ projectId: id, userId, role }).returning();
  res.status(201).json({ ...member });
});

router.delete("/:id/members/:userId", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const userId = parseInt(req.params.userId);
  await db.delete(projectMembersTable).where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));
  res.status(204).send();
});

export default router;
