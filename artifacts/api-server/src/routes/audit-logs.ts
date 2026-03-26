import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, desc, gte, lte, like, or } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { projectId, entityType, action, userId, dateFrom, dateTo, search, limit, page } = req.query;
  const lim = Math.min(parseInt(limit as string || "100"), 500);
  const pg = Math.max(1, parseInt(page as string || "1"));
  const offset = (pg - 1) * lim;

  let logs = await db.select({
    log: auditLogsTable,
    user: usersTable,
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(lim + 1)
    .offset(offset);

  if (projectId) {
    const pId = parseInt(projectId as string);
    logs = logs.filter(l => l.log.projectId === pId);
  }
  if (entityType && entityType !== "all") {
    logs = logs.filter(l => l.log.entityType === entityType);
  }
  if (action && action !== "all") {
    logs = logs.filter(l => l.log.action === action);
  }
  if (userId) {
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
      (l.user && `${l.user.firstName} ${l.user.lastName}`.toLowerCase().includes(q))
    );
  }

  const hasMore = logs.length > lim;
  const items = hasMore ? logs.slice(0, lim) : logs;

  res.json({
    logs: items.map(({ log, user }) => ({
      ...log,
      userName: user ? `${user.firstName} ${user.lastName}` : "System",
      userEmail: user?.email,
    })),
    total: items.length,
    page: pg,
    hasMore,
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
