import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  projectsTable, correspondenceTable, documentsTable,
} from "@workspace/db";
import { eq, inArray, lt, and, gte, isNotNull, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/notifications/summary", requireAuth, async (req, res): Promise<void> => {
  try {
    const orgProjects = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, req.user!.organizationId));
    const pids = orgProjects.map(p => p.id);

    if (!pids.length) {
      res.json({ openITR: 0, openNCR: 0, pendingNOC: 0, overdueCorrespondence: 0, newRevisions: 0 });
      return;
    }

    const pidList = pids.join(",");

    const [itrCount, ncrCount, nocCount, corrCount, revCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(inspectionRequestsTable)
        .where(and(
          inArray(inspectionRequestsTable.projectId, pids),
          sql`${inspectionRequestsTable.status} IN ('pending','scheduled','in_progress')`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(ncrRecordsTable)
        .where(and(
          inArray(ncrRecordsTable.projectId, pids),
          sql`${ncrRecordsTable.status} IN ('open','in_progress')`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(nocRecordsTable)
        .where(and(
          inArray(nocRecordsTable.projectId, pids),
          eq(nocRecordsTable.status, "pending"),
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(correspondenceTable)
        .where(and(
          isNotNull(correspondenceTable.projectId),
          inArray(correspondenceTable.projectId as any, pids),
          lt(correspondenceTable.dueDate, new Date()),
          sql`${correspondenceTable.status} NOT IN ('closed','responded')`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(documentsTable)
        .where(and(
          inArray(documentsTable.projectId, pids),
          gte(documentsTable.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        )),
    ]);

    res.json({
      openITR: itrCount[0]?.count ?? 0,
      openNCR: ncrCount[0]?.count ?? 0,
      pendingNOC: nocCount[0]?.count ?? 0,
      overdueCorrespondence: corrCount[0]?.count ?? 0,
      newRevisions: revCount[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("Notification summary error:", err);
    res.json({ openITR: 0, openNCR: 0, pendingNOC: 0, overdueCorrespondence: 0, newRevisions: 0 });
  }
});

export default router;
