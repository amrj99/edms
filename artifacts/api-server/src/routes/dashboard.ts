import { Router } from "express";
import { db } from "@workspace/db";
import {
  documentsTable, wfInstancesTable, wfTemplateStagesTable, tasksTable,
  correspondenceTable, correspondenceRecipientsTable, usersTable,
  foldersTable, projectsTable, projectMembersTable, meetingsTable, meetingActionItemsTable,
  ncrRecordsTable, deliverablesTable,
} from "@workspace/db";
import { eq, and, count, desc, gte, lt, lte, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { paramIntOrNull } from "../lib/params.js";

// ─── Roles that can see all org projects in reports (no membership check) ──────
const ELEVATED_ROLES = ["system_owner", "admin"] as const;
function isElevatedRole(role: string): boolean {
  return (ELEVATED_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve the list of project IDs a user is allowed to query in reports/dashboard.
 *  - Elevated (admin, system_owner): all projects in the org.
 *  - Everyone else: only projects they are a member of, intersected with the org.
 * Always returns an array (empty = no accessible projects).
 */
async function resolveAccessibleProjectIds(
  userId: number,
  orgId: number | undefined,
  role: string,
  specificProjectId?: number,
): Promise<number[]> {
  if (!orgId) return [];

  if (specificProjectId) {
    // Validate the user can see this specific project before returning it.
    if (isElevatedRole(role)) {
      const [proj] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(and(eq(projectsTable.id, specificProjectId), eq(projectsTable.organizationId, orgId)));
      return proj ? [specificProjectId] : [];
    }
    // Regular user: must have a membership entry for this project within the org.
    const [row] = await db
      .select({ id: projectsTable.id })
      .from(projectMembersTable)
      .innerJoin(projectsTable, and(
        eq(projectsTable.id, projectMembersTable.projectId),
        eq(projectsTable.organizationId, orgId),
      ))
      .where(and(
        eq(projectMembersTable.userId, userId),
        eq(projectMembersTable.projectId, specificProjectId),
      ));
    return row ? [specificProjectId] : [];
  }

  if (isElevatedRole(role)) {
    const rows = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, orgId));
    return rows.map(r => r.id);
  }

  // Regular user: projects they are a member of, scoped to this org.
  const memberships = await db
    .select({ projectId: projectMembersTable.projectId })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, userId));
  const memberProjectIds = memberships.map(m => m.projectId);
  if (memberProjectIds.length === 0) return [];

  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.organizationId, orgId),
      inArray(projectsTable.id, memberProjectIds),
    ));
  return rows.map(r => r.id);
}

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const projectId = paramIntOrNull(req.query.projectId as string | undefined) ?? undefined;

    let orgProjectIds: number[] | undefined;
    if (!projectId && orgId) {
      const orgProjects = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.organizationId, orgId));
      orgProjectIds = orgProjects.map(p => p.id);
    }

    const buildDocFilter = () => {
      if (projectId) return and(eq(documentsTable.projectId, projectId));
      if (orgProjectIds && orgProjectIds.length > 0) return inArray(documentsTable.projectId, orgProjectIds);
      if (orgProjectIds && orgProjectIds.length === 0) return eq(documentsTable.projectId, -1);
      return undefined;
    };

    const buildWfFilter = (extra?: ReturnType<typeof eq>) => {
      if (projectId) return and(eq(wfInstancesTable.projectId, projectId), extra);
      if (orgProjectIds && orgProjectIds.length > 0) return and(inArray(wfInstancesTable.projectId, orgProjectIds), extra);
      if (orgProjectIds && orgProjectIds.length === 0) return and(eq(wfInstancesTable.projectId, -1), extra);
      return extra;
    };

    const docFilter = buildDocFilter();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalDocsResult] = await db.select({ cnt: count() }).from(documentsTable).where(docFilter);

    const [pendingApprovalsResult] = await db.select({ cnt: count() }).from(wfInstancesTable)
      .where(buildWfFilter(eq(wfInstancesTable.status, "active") as any));

    const [openTasksResult] = await db.select({ cnt: count() }).from(tasksTable)
      .where(and(eq(tasksTable.assignedToId, userId), eq(tasksTable.status, "pending")));

    const receivedRels = await db.select({ corrId: correspondenceRecipientsTable.correspondenceId })
      .from(correspondenceRecipientsTable)
      .where(eq(correspondenceRecipientsTable.userId, userId));

    const receivedIds = receivedRels.map(r => r.corrId);
    let unreadCorr = 0;
    if (receivedIds.length > 0) {
      const unread = await db.select().from(correspondenceTable)
        .where(eq(correspondenceTable.status, "sent"));
      unreadCorr = unread.filter(c => receivedIds.includes(c.id)).length;
    }

    const [docsThisMonthResult] = await db.select({ cnt: count() }).from(documentsTable)
      .where(docFilter
        ? and(docFilter, gte(documentsTable.createdAt, startOfMonth))
        : gte(documentsTable.createdAt, startOfMonth));

    const [activeWorkflowsResult] = await db.select({ cnt: count() }).from(wfInstancesTable)
      .where(buildWfFilter(eq(wfInstancesTable.status, "active") as any));

    let recentDocs = await db.select({
      doc: documentsTable,
      createdBy: usersTable,
      folder: foldersTable,
    }).from(documentsTable)
      .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
      .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
      .where(docFilter)
      .orderBy(desc(documentsTable.updatedAt))
      .limit(5);

    // Pending approvals from new workflow engine
    let pendingWorkflows = await db.select({
      wf: wfInstancesTable,
      stage: wfTemplateStagesTable,
    }).from(wfInstancesTable)
      .leftJoin(wfTemplateStagesTable, eq(wfInstancesTable.currentStageId, wfTemplateStagesTable.id))
      .where(buildWfFilter(eq(wfInstancesTable.status, "active") as any))
      .orderBy(desc(wfInstancesTable.updatedAt))
      .limit(5);

    const docIds = pendingWorkflows.map(w => w.wf.documentId);
    const workflowDocs = docIds.length > 0 ? await db.select().from(documentsTable).where(inArray(documentsTable.id, docIds)) : [];
    // Tenant isolation + scale: resolve initiator names for ONLY the users referenced by
    // the (already org-scoped) pending workflows — never load the whole users table.
    // The referenced IDs are authorization-bounded by buildWfFilter above; no org filter is
    // added here on purpose, so an authorized cross-org party initiator's name still resolves.
    const initiatorIds = [...new Set(
      pendingWorkflows.map(w => w.wf.initiatedById).filter((id): id is number => id != null),
    )];
    const workflowUsers = initiatorIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, initiatorIds))
      : [];
    const docMap = new Map(workflowDocs.map(d => [d.id, d]));
    const userMap = new Map(workflowUsers.map(u => [u.id, u]));

    const enrichedWorkflows = pendingWorkflows.map(({ wf, stage }) => {
      const doc = docMap.get(wf.documentId);
      const initiatedBy = userMap.get(wf.initiatedById);
      return {
        ...wf,
        currentStageName: stage?.name,
        documentTitle: doc?.title,
        documentNumber: doc?.documentNumber,
        initiatedByName: initiatedBy ? `${initiatedBy.firstName} ${initiatedBy.lastName}` : undefined,
      };
    });

    const myTasks = await db.select({
      task: tasksTable,
      project: projectsTable,
    }).from(tasksTable)
      .leftJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
      .where(and(eq(tasksTable.assignedToId, userId), eq(tasksTable.status, "pending")))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(5);

    let unreadCorrItems: any[] = [];
    if (receivedIds.length > 0) {
      const items = await db.select().from(correspondenceTable)
        .where(eq(correspondenceTable.status, "sent"))
        .orderBy(desc(correspondenceTable.createdAt))
        .limit(5);
      unreadCorrItems = items.filter(c => receivedIds.includes(c.id)).map(c => ({
        ...c, toUserIds: [], toUserNames: [], attachments: [], fromUserName: undefined,
      }));
    }

    res.json({
      stats: {
        totalDocuments: Number(totalDocsResult?.cnt ?? 0),
        pendingApprovals: Number(pendingApprovalsResult?.cnt ?? 0),
        openTasks: Number(openTasksResult?.cnt ?? 0),
        unreadCorrespondence: unreadCorr,
        documentsThisMonth: Number(docsThisMonthResult?.cnt ?? 0),
        activeWorkflows: Number(activeWorkflowsResult?.cnt ?? 0),
      },
      recentDocuments: recentDocs.map(({ doc, createdBy, folder }) => ({
        ...doc,
        createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
        folderName: folder?.name,
      })),
      pendingApprovals: enrichedWorkflows,
      myTasks: myTasks.map(({ task, project }) => ({
        ...task,
        projectName: project?.name,
        assignedToName: undefined,
        createdByName: undefined,
      })),
      unreadCorrespondence: unreadCorrItems,
    });
  } catch (err: any) {
    logger.error({ err }, "[dashboard GET /] failed");
    throw err; // Express 5 → globalErrorHandler
  }
});

// ─── Reports Summary endpoint ──────────────────────────────────────────────────
router.get("/reports", requireAuth, async (req, res): Promise<void> => {
  try {
    const user      = req.user!;
    const orgId     = user.organizationId;
    const requestedProjectId = paramIntOrNull(req.query.projectId as string | undefined) ?? undefined;

    // Resolve project IDs the user is actually allowed to see.
    // For admins/system_owners this is all org projects; for others it is their
    // project memberships, optionally narrowed to a specific requested project.
    const projectIds = await resolveAccessibleProjectIds(
      user.id,
      orgId,
      user.role,
      requestedProjectId,
    );

    // The effective single-project shortcut (for filter builder) is only valid
    // when the caller explicitly requested it AND the user has access.
    const projectId = requestedProjectId && projectIds.length === 1 && projectIds[0] === requestedProjectId
      ? requestedProjectId
      : undefined;

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);

    const buildFilter = (col: any) => {
      if (projectId) return eq(col, projectId);
      if (projectIds.length > 0) return inArray(col, projectIds);
      // No accessible projects — return nothing.
      return sql`false`;
    };

    const docsByStatus = await db
      .select({ status: documentsTable.status, cnt: count() })
      .from(documentsTable)
      .where(buildFilter(documentsTable.projectId))
      .groupBy(documentsTable.status);

    const openNcrs = await db.select().from(ncrRecordsTable)
      .where(and(buildFilter(ncrRecordsTable.projectId), sql`${ncrRecordsTable.status} IN ('open','in_progress')`))
      .orderBy(desc(ncrRecordsTable.createdAt)).limit(20);

    const allActionItems = await db.select({
      item: meetingActionItemsTable,
      meeting: { projectId: meetingsTable.projectId, title: meetingsTable.title, referenceNumber: meetingsTable.referenceNumber },
      assignedTo: { firstName: usersTable.firstName, lastName: usersTable.lastName },
    })
      .from(meetingActionItemsTable)
      .leftJoin(meetingsTable, eq(meetingActionItemsTable.meetingId, meetingsTable.id))
      .leftJoin(usersTable, eq(meetingActionItemsTable.assignedToId, usersTable.id))
      .orderBy(meetingActionItemsTable.dueDate);

    const filteredItems = allActionItems.filter(r => {
      if (projectIds.length === 0) return false;
      if (!r.meeting) return false;
      return r.meeting.projectId ? projectIds.includes(r.meeting.projectId) : false;
    });

    const overdueActionItems = filteredItems.filter(r =>
      r.item.dueDate && r.item.dueDate < now && r.item.status !== "done"
    ).map(r => ({
      ...r.item,
      meetingTitle: r.meeting?.title,
      meetingRef: r.meeting?.referenceNumber,
      assignedToName: r.assignedTo ? `${r.assignedTo.firstName} ${r.assignedTo.lastName}` : r.item.assignedToName,
    }));

    const meetingsThisWeek = await db.select({
      meeting: meetingsTable,
      project: { name: projectsTable.name, code: projectsTable.code },
    })
      .from(meetingsTable)
      .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
      .where(and(
        buildFilter(meetingsTable.projectId),
        gte(meetingsTable.meetingDate, weekStart),
        lt(meetingsTable.meetingDate, weekEnd),
      ))
      .orderBy(meetingsTable.meetingDate);

    const recentCorr = await db.select({
      id: correspondenceTable.id,
      createdAt: correspondenceTable.createdAt,
      status: correspondenceTable.status,
    })
      .from(correspondenceTable)
      .where(and(
        gte(correspondenceTable.createdAt, sevenDaysAgo),
        orgId ? eq(correspondenceTable.organizationId, orgId) : undefined,
      ))
      .orderBy(correspondenceTable.createdAt);

    const corrByDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      corrByDay[d.toISOString().split("T")[0]] = 0;
    }
    recentCorr.forEach(c => {
      const day = c.createdAt.toISOString().split("T")[0];
      if (corrByDay[day] !== undefined) corrByDay[day]++;
    });

    const deliverables = await db.select()
      .from(deliverablesTable)
      .where(buildFilter(deliverablesTable.projectId));

    const delByStatus = deliverables.reduce((acc: Record<string, number>, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      documentsByStatus: docsByStatus,
      openNcrs,
      overdueActionItems,
      meetingsThisWeek: meetingsThisWeek.map(r => ({
        ...r.meeting,
        projectName: r.project?.name,
        projectCode: r.project?.code,
      })),
      correspondenceVolume: Object.entries(corrByDay).map(([date, count]) => ({ date, count })),
      deliverablesProgress: delByStatus,
      totalDeliverables: deliverables.length,
      summary: {
        totalDocuments: docsByStatus.reduce((s, r) => s + Number(r.cnt), 0),
        openNcrCount: openNcrs.length,
        overdueActionItemCount: overdueActionItems.length,
        meetingsThisWeekCount: meetingsThisWeek.length,
        totalDeliverables: deliverables.length,
        completedDeliverables: deliverables.filter(d => d.status === "approved" || d.status === "closed").length,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "[dashboard GET /reports] failed");
    throw err; // Express 5 → globalErrorHandler
  }
});

export default router;
