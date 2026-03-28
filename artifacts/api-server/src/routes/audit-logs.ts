import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { isSysAdmin } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { projectId, entityType, action, userId, dateFrom, dateTo, search, limit, page } = req.query;
  const lim = Math.min(parseInt(limit as string || "50"), 500);
  const pg = Math.max(1, parseInt(page as string || "1"));
  const offset = (pg - 1) * lim;

  // Fetch all logs with user + project name joins
  let logs = await db.select({
    log: auditLogsTable,
    user: {
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      organizationId: usersTable.organizationId,
    },
    project: {
      id: projectsTable.id,
      name: projectsTable.name,
      code: projectsTable.code,
      organizationId: projectsTable.organizationId,
    },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .leftJoin(projectsTable, eq(auditLogsTable.projectId, projectsTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5000);

  // Org scoping: non-sysadmin/non-admin only see their own org's logs
  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    const orgId = currentUser.organizationId;
    logs = logs.filter(l =>
      (l.user && l.user.organizationId === orgId) ||
      (l.project && l.project.organizationId === orgId) ||
      (!l.user && !l.project)
    );
  }

  // Apply filters
  if (projectId && projectId !== "_all") {
    const pId = parseInt(projectId as string);
    logs = logs.filter(l => l.log.projectId === pId);
  }
  if (entityType && entityType !== "_all") {
    logs = logs.filter(l => l.log.entityType === entityType);
  }
  if (action && action !== "_all") {
    logs = logs.filter(l => l.log.action === action);
  }
  if (userId && userId !== "_all") {
    const uId = parseInt(userId as string);
    logs = logs.filter(l => l.log.userId === uId);
  }
  if (dateFrom) {
    const from = new Date(dateFrom as string);
    logs = logs.filter(l => new Date(l.log.createdAt!) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo as string);
    to.setHours(23, 59, 59, 999);
    logs = logs.filter(l => new Date(l.log.createdAt!) <= to);
  }
  if (search) {
    const q = (search as string).toLowerCase();
    logs = logs.filter(l =>
      l.log.entityTitle?.toLowerCase().includes(q) ||
      l.log.action?.toLowerCase().includes(q) ||
      l.log.entityType?.toLowerCase().includes(q) ||
      (l.user && `${l.user.firstName} ${l.user.lastName}`.toLowerCase().includes(q)) ||
      l.project?.name?.toLowerCase().includes(q)
    );
  }

  const total = logs.length;
  const items = logs.slice(offset, offset + lim);
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

// Excel export endpoint for Activity Log
router.get("/export-xlsx", requireAuth, async (req, res) => {
  const { projectId, entityType, action, userId, dateFrom, dateTo, search } = req.query;

  let logs = await db.select({
    log: auditLogsTable,
    user: {
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      organizationId: usersTable.organizationId,
    },
    project: {
      id: projectsTable.id,
      name: projectsTable.name,
      code: projectsTable.code,
      organizationId: projectsTable.organizationId,
    },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .leftJoin(projectsTable, eq(auditLogsTable.projectId, projectsTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5000);

  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    const orgId = currentUser.organizationId;
    logs = logs.filter(l =>
      (l.user && l.user.organizationId === orgId) ||
      (l.project && l.project.organizationId === orgId) ||
      (!l.user && !l.project)
    );
  }

  if (projectId && projectId !== "_all") logs = logs.filter(l => l.log.projectId === parseInt(projectId as string));
  if (entityType && entityType !== "_all") logs = logs.filter(l => l.log.entityType === entityType);
  if (action && action !== "_all") logs = logs.filter(l => l.log.action === action);
  if (userId && userId !== "_all") logs = logs.filter(l => l.log.userId === parseInt(userId as string));
  if (dateFrom) { const d = new Date(dateFrom as string); logs = logs.filter(l => new Date(l.log.createdAt!) >= d); }
  if (dateTo) { const d = new Date(dateTo as string); d.setHours(23, 59, 59, 999); logs = logs.filter(l => new Date(l.log.createdAt!) <= d); }
  if (search) {
    const q = (search as string).toLowerCase();
    logs = logs.filter(l =>
      l.log.entityTitle?.toLowerCase().includes(q) ||
      l.log.action?.toLowerCase().includes(q) ||
      (l.user && `${l.user.firstName} ${l.user.lastName}`.toLowerCase().includes(q))
    );
  }

  // Return JSON data for xlsx export on frontend
  res.json({
    data: logs.map(({ log, user, project }) => ({
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

// CSV export endpoint
router.get("/export", requireAuth, async (req, res) => {
  const { projectId, entityType, action, dateFrom, dateTo } = req.query;

  let logs = await db.select({
    log: auditLogsTable,
    user: usersTable,
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5000);

  if (projectId) logs = logs.filter(l => l.log.projectId === parseInt(projectId as string));
  if (entityType && entityType !== "all") logs = logs.filter(l => l.log.entityType === entityType);
  if (action && action !== "all") logs = logs.filter(l => l.log.action === action);
  if (dateFrom) { const d = new Date(dateFrom as string); logs = logs.filter(l => new Date(l.log.createdAt!) >= d); }
  if (dateTo) { const d = new Date(dateTo as string); d.setHours(23, 59, 59, 999); logs = logs.filter(l => new Date(l.log.createdAt!) <= d); }

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

  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

export default router;
