import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import {
  correspondenceTable,
  transmittalsTable,
  transmittalItemsTable,
  wfInstancesTable,
  wfTemplateStagesTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, lt, count, sql, ne, isNotNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { paramInt, type ProjectParams } from '../lib/params';
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router({ mergeParams: true });

const GOV_ROLES = ["system_owner", "admin", "project_manager", "document_controller"] as const;

router.get("/governance/stats", requireAuth, requireRole(...GOV_ROLES), async (req: Request<ProjectParams>, res) => {
  const projectId = paramInt(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const now = new Date();

  // ── Correspondence: overdue ────────────────────────────────────────────────
  const overdueCorrespondence = await db
    .select({
      id: correspondenceTable.id,
      subject: correspondenceTable.subject,
      type: correspondenceTable.type,
      priority: correspondenceTable.priority,
      dueDate: correspondenceTable.dueDate,
      status: correspondenceTable.status,
      requiresResponse: correspondenceTable.requiresResponse,
      referenceNumber: correspondenceTable.referenceNumber,
      sentAt: correspondenceTable.sentAt,
    })
    .from(correspondenceTable)
    .where(
      and(
        eq(correspondenceTable.projectId, projectId),
        lt(correspondenceTable.dueDate, now),
        ne(correspondenceTable.status, "closed"),
        ne(correspondenceTable.status, "draft"),
      )
    )
    .orderBy(correspondenceTable.dueDate)
    .limit(50);

  // ── Correspondence: requires response (not yet closed/responded) ──────────
  const awaitingResponse = await db
    .select({
      id: correspondenceTable.id,
      subject: correspondenceTable.subject,
      type: correspondenceTable.type,
      priority: correspondenceTable.priority,
      dueDate: correspondenceTable.dueDate,
      status: correspondenceTable.status,
      referenceNumber: correspondenceTable.referenceNumber,
      sentAt: correspondenceTable.sentAt,
    })
    .from(correspondenceTable)
    .where(
      and(
        eq(correspondenceTable.projectId, projectId),
        eq(correspondenceTable.requiresResponse, true),
        ne(correspondenceTable.status, "responded"),
        ne(correspondenceTable.status, "closed"),
        ne(correspondenceTable.status, "draft"),
      )
    )
    .orderBy(correspondenceTable.dueDate)
    .limit(50);

  // ── Correspondence: counts by status ─────────────────────────────────────
  const corrByStatus = await db
    .select({
      status: correspondenceTable.status,
      cnt: count(),
    })
    .from(correspondenceTable)
    .where(eq(correspondenceTable.projectId, projectId))
    .groupBy(correspondenceTable.status);

  // ── Correspondence: SLA % ─────────────────────────────────────────────────
  const [totalWithDueRow] = await db
    .select({ totalWithDue: count() })
    .from(correspondenceTable)
    .where(and(eq(correspondenceTable.projectId, projectId), isNotNull(correspondenceTable.dueDate)));

  const totalWithDue = Number(totalWithDueRow?.totalWithDue ?? 0);

  const [respondedOnTimeRow] = await db
    .select({ respondedOnTime: count() })
    .from(correspondenceTable)
    .where(
      and(
        eq(correspondenceTable.projectId, projectId),
        isNotNull(correspondenceTable.dueDate),
        eq(correspondenceTable.status, "responded"),
        sql`${correspondenceTable.closedAt} <= ${correspondenceTable.dueDate}`,
      )
    );

  const respondedOnTime = Number(respondedOnTimeRow?.respondedOnTime ?? 0);
  const slaCompliance = totalWithDue > 0 ? Math.round((respondedOnTime / totalWithDue) * 100) : null;

  // ── Transmittals: by status ───────────────────────────────────────────────
  const transmittalStats = await db
    .select({
      status: transmittalsTable.status,
      approvalStatus: transmittalsTable.approvalStatus,
      cnt: count(),
    })
    .from(transmittalsTable)
    .where(eq(transmittalsTable.projectId, projectId))
    .groupBy(transmittalsTable.status, transmittalsTable.approvalStatus);

  // Overdue transmittals (sent but not acknowledged, past dueDate)
  const overdueTransmittals = await db
    .select({
      id: transmittalsTable.id,
      transmittalNumber: transmittalsTable.transmittalNumber,
      subject: transmittalsTable.subject,
      dueDate: transmittalsTable.dueDate,
      status: transmittalsTable.status,
      sentAt: transmittalsTable.sentAt,
    })
    .from(transmittalsTable)
    .where(
      and(
        eq(transmittalsTable.projectId, projectId),
        eq(transmittalsTable.status, "sent"),
        lt(transmittalsTable.dueDate, now),
      )
    )
    .orderBy(transmittalsTable.dueDate)
    .limit(20);

  // ── Transmittal items: review code summary ────────────────────────────────
  const reviewCodeSummary = await db
    .select({
      reviewCode: transmittalItemsTable.reviewCode,
      cnt: count(),
    })
    .from(transmittalItemsTable)
    .innerJoin(transmittalsTable, eq(transmittalItemsTable.transmittalId, transmittalsTable.id))
    .where(
      and(
        eq(transmittalsTable.projectId, projectId),
        ne(transmittalsTable.status, "draft"),
      )
    )
    .groupBy(transmittalItemsTable.reviewCode);

  // ── Active workflow instances ─────────────────────────────────────────────
  const activeWorkflows = await db
    .select({
      id: wfInstancesTable.id,
      status: wfInstancesTable.status,
      currentStageId: wfInstancesTable.currentStageId,
      createdAt: wfInstancesTable.createdAt,
      documentId: wfInstancesTable.documentId,
    })
    .from(wfInstancesTable)
    .where(
      and(
        eq(wfInstancesTable.projectId, projectId),
        eq(wfInstancesTable.status, "active"),
      )
    )
    .orderBy(wfInstancesTable.createdAt)
    .limit(50);

  // Enrich with document titles
  const docIds = activeWorkflows.map(w => w.documentId).filter((id): id is number => id != null);
  let docTitles: Record<number, string> = {};
  if (docIds.length > 0) {
    const docs = await db
      .select({ id: documentsTable.id, title: documentsTable.title, documentNumber: documentsTable.documentNumber })
      .from(documentsTable)
      .where(inArray(documentsTable.id, docIds));
    docTitles = Object.fromEntries(docs.map(d => [d.id, `${d.documentNumber} — ${d.title}`]));
  }

  // Enrich with stage names
  const stageIds = activeWorkflows.map(w => w.currentStageId).filter((id): id is number => id != null);
  let stageNames: Record<number, string> = {};
  if (stageIds.length > 0) {
    const stages = await db
      .select({ id: wfTemplateStagesTable.id, name: wfTemplateStagesTable.name })
      .from(wfTemplateStagesTable)
      .where(inArray(wfTemplateStagesTable.id, stageIds));
    stageNames = Object.fromEntries(stages.map(s => [s.id, s.name]));
  }

  // Bottleneck: which stage has the most stuck workflows
  const stageCounts: Record<string, number> = {};
  for (const wf of activeWorkflows) {
    const label = wf.currentStageId ? (stageNames[wf.currentStageId] ?? `Stage ${wf.currentStageId}`) : "Unknown";
    stageCounts[label] = (stageCounts[label] ?? 0) + 1;
  }
  const bottlenecks = Object.entries(stageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));

  // ── Documents: status summary ─────────────────────────────────────────────
  const docsByStatus = await db
    .select({ status: documentsTable.status, cnt: count() })
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId))
    .groupBy(documentsTable.status);

  res.json({
    correspondence: {
      overdue: overdueCorrespondence,
      overdueCount: overdueCorrespondence.length,
      awaitingResponse,
      awaitingResponseCount: awaitingResponse.length,
      byStatus: corrByStatus,
      slaCompliance,
    },
    transmittals: {
      byStatus: transmittalStats,
      overdue: overdueTransmittals,
      overdueCount: overdueTransmittals.length,
      reviewCodeSummary,
    },
    workflows: {
      activeCount: activeWorkflows.length,
      active: activeWorkflows.map(wf => ({
        id: wf.id,
        documentTitle: wf.documentId ? (docTitles[wf.documentId] ?? `Document ${wf.documentId}`) : "Unknown",
        currentStage: wf.currentStageId ? (stageNames[wf.currentStageId] ?? `Stage ${wf.currentStageId}`) : "Unknown",
        createdAt: wf.createdAt,
      })),
      bottlenecks,
    },
    documents: {
      byStatus: docsByStatus,
    },
  });
});

export default router;
