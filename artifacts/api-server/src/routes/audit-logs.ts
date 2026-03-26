import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { projectId, entityType, limit } = req.query;
  const lim = limit ? parseInt(limit as string) : 50;

  let logs = await db.select({
    log: auditLogsTable,
    user: usersTable,
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(lim);

  if (projectId) {
    const pId = parseInt(projectId as string);
    logs = logs.filter(l => l.log.projectId === pId);
  }
  if (entityType) {
    logs = logs.filter(l => l.log.entityType === entityType);
  }

  res.json({
    logs: logs.map(({ log, user }) => ({
      ...log,
      userName: user ? `${user.firstName} ${user.lastName}` : undefined,
    })),
    total: logs.length,
  });
});

export default router;
