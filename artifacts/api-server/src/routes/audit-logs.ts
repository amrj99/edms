import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable, projectsTable } from "@workspace/db";
import { eq, and, desc, gte, lte, ilike, or, inArray, count, type SQL } from "drizzle-orm";
import { requireAuth, isSysAdmin, requireRole } from "../lib/auth.js";

const router = Router();

const AUDIT_ROLES = ["system_owner", "admin", "project_manager", "document_controller"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely extract a string query-param value. */
function qstr(val: unknown): string | undefined {
  return typeof val === "string" && val !== "" ? val : undefined;
}

/** Build a WHERE condition that scopes audit logs to a single organization. */
async function buildOrgCondition(organizationId: number): Promise<SQL<unknown>> {
  const [orgUsers, orgProjects] = await Promise.all([
    db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.organizationId, organizationId)),
    db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.organizationId, organizationId)),
  ]);

  const userIds = orgUsers.map(u => u.id);
  const projectIds = orgProjects.map(p => p.id);

  const clauses: SQL<unknown>[] = [];
  if (userIds.length > 0) clauses.push(inArray(auditLogsTable.userId, userIds));
  if (projectIds.length > 0) clauses.push(inArray(auditLogsTable.projectId, projectIds));

  // If the org has no users and no projects, return a condition that matches nothing.
  if (clauses.length === 0) return eq(auditLogsTable.id, -1);

  const [first, ...rest] = clauses;
  return rest.length > 0 ? (or(first, ...rest) as SQL<unknown>) : first;
}

/** Combine an array of conditions with AND, returning undefined when empty. */
function buildWhere(conditions: SQL<unknown>[]): SQL<unknown> | undefined {
  if (conditions.length === 0) return undefined;
  const [first, ...rest] = conditions;
  return rest.length > 0 ? (and(first, ...rest) as SQL<unknown>) : first;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/", requireAuth, requireRole(...AUDIT_ROLES), async (req, res) => {
  const lim = Math.min(parseInt(qstr(req.query.limit) ?? "50"), 200);
  const pg  = Math.max(1, parseInt(qstr(req.query.page) ?? "1"));
  const offset = (pg - 1) * lim;

  const projectId  = qstr(req.query.projectId);
  const entityType = qstr(req.query.entityType);
  const action     = qstr(req.query.action);
  const userId     = qstr(req.query.userId);
  const dateFrom   = qstr(req.query.dateFrom);
  const dateTo     = qstr(req.query.dateTo);
  const search     = qstr(req.query.search);

  const conditions: SQL<unknown>[] = [];

  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    conditions.push(await buildOrgCondition(currentUser.organizationId!));
  }
  if (projectId  && projectId  !== "_all") conditions.push(eq(auditLogsTable.projectId,  parseInt(projectId)));
  if (entityType && entityType !== "_all") conditions.push(eq(auditLogsTable.entityType, entityType));
  if (action     && action     !== "_all") conditions.push(eq(auditLogsTable.action,     action));
  if (userId     && userId     !== "_all") conditions.push(eq(auditLogsTable.userId,     parseInt(userId)));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, to));
  }
  if (search) {
    const q = `%${search}%`;
    conditions.push(
      or(ilike(auditLogsTable.entityTitle, q), ilike(auditLogsTable.action, q), ilike(auditLogsTable.entityType, q)) as SQL<unknown>
    );
  }

  const where = buildWhere(conditions);

  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);

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
      userEmail: user?.email ?? null,
      projectName: project?.name ?? null,
      projectCode: project?.code ?? null,
    })),
    total,
    page: pg,
    totalPages,
    hasMore: pg < totalPages,
  });
});

// ─── Excel export ─────────────────────────────────────────────────────────────

router.get("/export-xlsx", requireAuth, requireRole(...AUDIT_ROLES), async (req, res) => {
  const projectId  = qstr(req.query.projectId);
  const entityType = qstr(req.query.entityType);
  const action     = qstr(req.query.action);
  const userId     = qstr(req.query.userId);
  const dateFrom   = qstr(req.query.dateFrom);
  const dateTo     = qstr(req.query.dateTo);
  const search     = qstr(req.query.search);

  const conditions: SQL<unknown>[] = [];

  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    conditions.push(await buildOrgCondition(currentUser.organizationId!));
  }
  if (projectId  && projectId  !== "_all") conditions.push(eq(auditLogsTable.projectId,  parseInt(projectId)));
  if (entityType && entityType !== "_all") conditions.push(eq(auditLogsTable.entityType, entityType));
  if (action     && action     !== "_all") conditions.push(eq(auditLogsTable.action,     action));
  if (userId     && userId     !== "_all") conditions.push(eq(auditLogsTable.userId,     parseInt(userId)));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, to));
  }
  if (search) {
    const q = `%${search}%`;
    conditions.push(or(ilike(auditLogsTable.entityTitle, q), ilike(auditLogsTable.action, q)) as SQL<unknown>);
  }

  const where = buildWhere(conditions);

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

// ─── CSV export (legacy) ──────────────────────────────────────────────────────

router.get("/export", requireAuth, requireRole(...AUDIT_ROLES), async (req, res) => {
  const projectId  = qstr(req.query.projectId);
  const entityType = qstr(req.query.entityType);
  const action     = qstr(req.query.action);
  const dateFrom   = qstr(req.query.dateFrom);
  const dateTo     = qstr(req.query.dateTo);

  const conditions: SQL<unknown>[] = [];

  const currentUser = req.user!;
  if (!isSysAdmin(currentUser)) {
    conditions.push(await buildOrgCondition(currentUser.organizationId!));
  }
  if (projectId  && projectId  !== "_all") conditions.push(eq(auditLogsTable.projectId,  parseInt(projectId)));
  if (entityType && entityType !== "_all" && entityType !== "all") conditions.push(eq(auditLogsTable.entityType, entityType));
  if (action     && action     !== "_all" && action     !== "all") conditions.push(eq(auditLogsTable.action,     action));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const d = new Date(dateTo);
    d.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, d));
  }

  const where = buildWhere(conditions);

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
