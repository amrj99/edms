import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, workflowsTable, tasksTable, correspondenceTable, correspondenceRecipientsTable, usersTable, foldersTable, projectsTable } from "@workspace/db";
import { eq, and, count, desc, gte, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const orgId = req.user!.organizationId;
  const isSystemOwner = req.user!.role === "system_owner";
  const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;

  // Resolve org-scoped project IDs when org context is active
  let orgProjectIds: number[] | undefined;
  if (!projectId && orgId) {
    const orgProjects = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.organizationId, orgId));
    orgProjectIds = orgProjects.map(p => p.id);
  }

  const buildDocFilter = () => {
    if (projectId) return and(eq(documentsTable.projectId, projectId));
    if (orgProjectIds && orgProjectIds.length > 0) return inArray(documentsTable.projectId, orgProjectIds);
    if (orgProjectIds && orgProjectIds.length === 0) return eq(documentsTable.projectId, -1); // no projects => no docs
    return undefined;
  };

  const buildWfFilter = (extra?: ReturnType<typeof eq>) => {
    if (projectId) return and(eq(workflowsTable.projectId, projectId), extra);
    if (orgProjectIds && orgProjectIds.length > 0) return and(inArray(workflowsTable.projectId, orgProjectIds), extra);
    if (orgProjectIds && orgProjectIds.length === 0) return and(eq(workflowsTable.projectId, -1), extra);
    return extra;
  };

  const docFilter = buildDocFilter();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Stats
  const [totalDocsResult] = await db.select({ cnt: count() }).from(documentsTable).where(docFilter);

  const [pendingApprovalsResult] = await db.select({ cnt: count() }).from(workflowsTable)
    .where(buildWfFilter(eq(workflowsTable.status, "active")));

  const [openTasksResult] = await db.select({ cnt: count() }).from(tasksTable)
    .where(and(eq(tasksTable.assignedToId, userId), eq(tasksTable.status, "pending")));

  // Unread correspondence
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

  const [activeWorkflowsResult] = await db.select({ cnt: count() }).from(workflowsTable)
    .where(buildWfFilter(eq(workflowsTable.status, "active")));

  // Recent documents
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

  // Pending approvals workflows
  let pendingWorkflows = await db.select().from(workflowsTable)
    .where(buildWfFilter(eq(workflowsTable.status, "active")))
    .orderBy(desc(workflowsTable.updatedAt))
    .limit(5);

  // Enrich workflows with doc info
  const docIds = pendingWorkflows.map(w => w.documentId);
  const workflowDocs = docIds.length > 0 ? await db.select().from(documentsTable) : [];
  const workflowUsers = await db.select().from(usersTable);
  const docMap = new Map(workflowDocs.map(d => [d.id, d]));
  const userMap = new Map(workflowUsers.map(u => [u.id, u]));

  const enrichedWorkflows = pendingWorkflows.map(w => {
    const doc = docMap.get(w.documentId);
    const initiatedBy = userMap.get(w.initiatedById);
    return { ...w, documentTitle: doc?.title, documentNumber: doc?.documentNumber, initiatedByName: initiatedBy ? `${initiatedBy.firstName} ${initiatedBy.lastName}` : undefined, steps: [] };
  });

  // My tasks
  const myTasks = await db.select({
    task: tasksTable,
    project: projectsTable,
  }).from(tasksTable)
    .leftJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .where(and(eq(tasksTable.assignedToId, userId), eq(tasksTable.status, "pending")))
    .orderBy(desc(tasksTable.updatedAt))
    .limit(5);

  // Unread correspondence items
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
});

export default router;
