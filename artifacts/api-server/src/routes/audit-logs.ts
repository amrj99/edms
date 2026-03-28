import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable, projectsTable } from "@workspace/db";
import { eq, and, desc, gte, lte, ilike, or, inArray, count } from "drizzle-orm";
import { requireAuth, isSysAdmin, requireRole } from "../lib/auth.js";

const router = Router();

// Only admin, project_manager, document_controller, and system_owner can access audit logs
const auditRoles = ["system_owner", "admin", "project_manager", "document_controller"];

// Build org-scope condition (pre-fetches org user/project IDs)
async function buildOrgCondition(organizationId: number) {
  const [orgUsers, orgProjects] = await Promise.all([
    db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.organizationId, organizationId)),
    db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.organizationId, organizationId)),
  ]);
  const userIds = orgUsers.map(u => u.id);
  const projectIds = orgProjects.map(p => p.id);

  const conditions = [];
  if (userIds.length > 0) conditions.push(inArray(auditLogsTable.userId, userIds));
  if (projectIds.length > 0) conditions.push(inArray(auditLogsTable.projectId, projectIds));
  if (conditions.length === 0) return eq(auditLogsTable.id, -1); // no data visible
  return or(...conditions as [any, ...any[]]);
}

router.get("/", requireAuth, requireRole(...auditRoles), async (req, res) => {
  const { projectId, entityType, action, userId, dateFrom, dateTo, search, limit, page } = req.query;
  const lim = Math.min(parseInt(limit as string || "50"), 200);
  const pg = Math.max(1, parseInt(page as string || "1"));
  const offset = (pg - 1) * lim;

  // Build WHERE conditions
  const conditions: any[] = [];

  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    const orgCond = await buildOrgCondition(currentUser.organizationId!);
    conditions.push(orgCond);
  }

  if (projectId && projectId !== "_all") {
    conditions.push(eq(auditLogsTable.projectId, parseInt(projectId as string)));
  }
  if (entityType && entityType !== "_all") {
    conditions.push(eq(auditLogsTable.entityType, entityType as string));
  }
  if (action && action !== "_all") {
    conditions.push(eq(auditLogsTable.action, action as string));
  }
  if (userId && userId !== "_all") {
    conditions.push(eq(auditLogsTable.userId, parseInt(userId as string)));
  }
  if (dateFrom) {
    conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom as string)));
  }
  if (dateTo) {
    const to = new Date(dateTo as string);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, to));
  }
  if (search) {
    const q = `%${search}%`;
    conditions.push(
      or(
        ilike(auditLogsTable.entityTitle, q),
        ilike(auditLogsTable.action, q),
        ilike(auditLogsTable.entityType, q)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // COUNT query for pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogsTable)
    .where(where);

  // Data query with joins
  const items = await db.select({
    log: auditLogsTable,
    user: {
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    },
    project: {
      id: projectsTable.id,
      name: projectsTable.name,
      code: projectsTable.code,
    },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .leftJoin(projectsTable, eq(auditLogsTable.projectId, projectsTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(lim)
    .offset(offset);

  const totalPages = Math.ceil(total / lim);

  res.json({
    logs: items.map(({ log, user, project }) => ({
      ...log,
      userName: user ? `${user.firstName} ${user.lastName}` : "System",
      userEmail: user?.email,
      projectName: project?.name,
      projectCode: project?.code,
    })),
    total,
    page: pg,
    totalPages,
    hasMore: pg < totalPages,
  });
});

// Excel export — same role guard, same org-scoped filtering
router.get("/export-xlsx", requireAuth, requireRole(...auditRoles), async (req, res) => {
  const { projectId, entityType, action, userId, dateFrom, dateTo, search } = req.query;

  const conditions: any[] = [];
  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    const orgCond = await buildOrgCondition(currentUser.organizationId!);
    conditions.push(orgCond);
  }

  if (projectId && projectId !== "_all") conditions.push(eq(auditLogsTable.projectId, parseInt(projectId as string)));
  if (entityType && entityType !== "_all") conditions.push(eq(auditLogsTable.entityType, entityType as string));
  if (action && action !== "_all") conditions.push(eq(auditLogsTable.action, action as string));
  if (userId && userId !== "_all") conditions.push(eq(auditLogsTable.userId, parseInt(userId as string)));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom as string)));
  if (dateTo) {
    const to = new Date(dateTo as string);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, to));
  }
  if (search) {
    const q = `%${search}%`;
    conditions.push(or(ilike(auditLogsTable.entityTitle, q), ilike(auditLogsTable.action, q)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db.select({
    log: auditLogsTable,
    user: {
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    },
    project: {
      name: projectsTable.name,
      code: projectsTable.code,
    },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .leftJoin(projectsTable, eq(auditLogsTable.projectId, projectsTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10000);

  res.json({
    data: items.map(({ log, user, project }) => ({
      id: log.id,
      timestamp: log.createdAt ? new Date(log.createdAt).toISOString() : "",
      user: user ? `${user.firstName} ${user.lastName}` : "System",
      userEmail: user?.email ?? "",
      action: log.action,
      entityType: log.entityType,
      entityTitle: log.entityTitle ?? "",
      project: project?.name ?? "",
      projectCode: project?.code ?? "",
      details: JSON.stringify(log.details ?? {}),
    })),
  });
});

// CSV export (for legacy admin panel) — restricted to admins
router.get("/export", requireAuth, requireRole(...auditRoles), async (req, res) => {
  const { projectId, entityType, action, dateFrom, dateTo } = req.query;

  const conditions: any[] = [];
  if (projectId) conditions.push(eq(auditLogsTable.projectId, parseInt(projectId as string)));
  if (entityType && entityType !== "all") conditions.push(eq(auditLogsTable.entityType, entityType as string));
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action as string));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom as string)));
  if (dateTo) {
    const d = new Date(dateTo as string);
    d.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, d));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db.select({
    log: auditLogsTable,
    user: usersTable,
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5000);

  const headers = ["ID", "Date/Time", "User", "Action", "Entity Type", "Entity Title", "Project ID"];
  const rows = logs.map(({ log, user }) => [
    log.id,
    new Date(log.createdAt!).toISOString(),
    user ? `${user.firstName} ${user.lastName} <${user.email}>` : "System",
    log.action,
    log.entityType,
    log.entityTitle ?? "",
    log.projectId ?? "",
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

export default router;
