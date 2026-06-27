/**
 * Configurable Workflow Engine
 *
 * Routes (all require auth; all scoped to req.user!.organizationId):
 *
 * Templates:
 *   GET    /workflow-engine/templates
 *   POST   /workflow-engine/templates
 *   GET    /workflow-engine/templates/:id
 *   PUT    /workflow-engine/templates/:id
 *   DELETE /workflow-engine/templates/:id
 *   POST   /workflow-engine/templates/:id/stages
 *   PUT    /workflow-engine/templates/:id/stages/:stageId
 *   DELETE /workflow-engine/templates/:id/stages/:stageId
 *   POST   /workflow-engine/seed-invoice   — seed Invoice template for org
 *
 * Instances:
 *   GET    /workflow-engine/instances      — filterable: docType, status, stageId, projectId
 *   POST   /workflow-engine/instances
 *   GET    /workflow-engine/instances/:id
 *   POST   /workflow-engine/instances/:id/advance
 *   POST   /workflow-engine/instances/:id/reject
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  wfTemplatesTable, wfTemplateStagesTable, wfInstancesTable, wfInstanceTransitionsTable,
  documentsTable, projectsTable, usersTable, notificationsTable, documentTypesTable, tasksTable,
} from "@workspace/db";
import { eq, and, desc, asc, inArray, or } from "drizzle-orm";
import { requireAuth, requireRole, type AuthUser } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { sendWorkflowStageEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import {param, paramInt, requireInt} from '../lib/params';
import { resolveEffectiveRole } from "../lib/governance.js";
import { checkWorkflowStagePermission, isValidAppRole, ALL_ROLES } from "../lib/permissions.js";

const router = Router();
router.use(requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function orgId(req: any): number {
  return req.user!.organizationId;
}

/** Compute the due timestamp for a stage based on its slaDays. Returns null if no SLA. */
function computeStageDueAt(stage: typeof wfTemplateStagesTable.$inferSelect | null | undefined): Date | null {
  if (!stage?.slaDays) return null;
  const due = new Date();
  due.setDate(due.getDate() + stage.slaDays);
  return due;
}

async function getTemplateWithStages(templateId: number, organizationId: number) {
  const [tpl] = await db.select().from(wfTemplatesTable)
    .where(and(eq(wfTemplatesTable.id, templateId), eq(wfTemplatesTable.organizationId, organizationId)))
    .limit(1);
  if (!tpl) return null;
  const stages = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.templateId, templateId))
    .orderBy(asc(wfTemplateStagesTable.stageOrder));
  return { ...tpl, stages };
}

/** Fetches the wf_template_stages row the instance is currently sitting at, or null. */
async function getCurrentStage(inst: typeof wfInstancesTable.$inferSelect) {
  if (!inst.currentStageId) return null;
  const [stage] = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1);
  return stage ?? null;
}

/**
 * Resolves the caller's effective role for a project, memoized per-request so
 * list endpoints don't re-resolve the same project's role for every instance.
 */
async function resolveEffectiveRoleCached(
  user: AuthUser,
  projectId: number | null | undefined,
  cache: Map<number | null, string>,
): Promise<string> {
  const key = projectId ?? null;
  const cached = cache.get(key);
  if (cached) return cached;
  const { role } = await resolveEffectiveRole(user, projectId ?? undefined);
  cache.set(key, role);
  return role;
}

async function enrichInstance(
  inst: typeof wfInstancesTable.$inferSelect,
  user: AuthUser,
  roleCache: Map<number | null, string>,
) {
  const [doc] = await db.select({ id: documentsTable.id, title: documentsTable.title, documentNumber: documentsTable.documentNumber, documentType: documentsTable.documentType, status: documentsTable.status })
    .from(documentsTable).where(eq(documentsTable.id, inst.documentId)).limit(1);
  const [tpl] = await db.select({ id: wfTemplatesTable.id, name: wfTemplatesTable.name, documentType: wfTemplatesTable.documentType })
    .from(wfTemplatesTable).where(eq(wfTemplatesTable.id, inst.templateId)).limit(1);
  const [initiatedBy] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, inst.initiatedById)).limit(1);
  const [currentStage] = inst.currentStageId
    ? await db.select().from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1)
    : [null];
  const allStages = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.templateId, inst.templateId))
    .orderBy(asc(wfTemplateStagesTable.stageOrder));
  const [proj] = inst.projectId
    ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, inst.projectId)).limit(1)
    : [null];

  const transitions = await db.select().from(wfInstanceTransitionsTable)
    .where(eq(wfInstanceTransitionsTable.instanceId, inst.id))
    .orderBy(asc(wfInstanceTransitionsTable.createdAt));
  const actorIds = [...new Set(transitions.map(t => t.actorId))];
  const actors = actorIds.length
    ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(inArray(usersTable.id, actorIds))
    : [];
  const actorMap = new Map(actors.map(a => [a.id, `${a.firstName} ${a.lastName}`.trim()]));

  const stageMap = new Map(allStages.map(s => [s.id, s.name]));

  // Whether the current caller may advance/reject this instance at its current stage
  const effectiveRole = await resolveEffectiveRoleCached(user, inst.projectId, roleCache);
  const canAct = inst.status === "active"
    && checkWorkflowStagePermission(effectiveRole, user.id, currentStage ?? null) !== null;

  // SLA computed fields
  const now = new Date();
  const stageDueAt = inst.stageDueAt ? new Date(inst.stageDueAt) : null;
  const isOverdue = stageDueAt !== null && inst.status === "active" && stageDueAt < now;
  const daysRemaining = stageDueAt !== null && inst.status === "active"
    ? Math.ceil((stageDueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    ...inst,
    documentTitle: doc?.title,
    documentNumber: doc?.documentNumber,
    documentType: tpl?.documentType ?? doc?.documentType,
    documentStatus: doc?.status,
    workflowName: tpl?.name,
    projectName: proj?.name,
    initiatedByName: initiatedBy ? `${initiatedBy.firstName} ${initiatedBy.lastName}`.trim() : undefined,
    currentStageName: currentStage?.name,
    currentStageRole: currentStage?.responsibleRole,
    currentStageResponsibleUserId: currentStage?.responsibleUserId ?? null,
    currentStageSla: currentStage?.slaDays ?? null,
    currentStageReminderDays: currentStage?.reminderDays ?? null,
    canAct,
    stageDueAt: inst.stageDueAt,
    isOverdue,
    daysRemaining,
    stagesTotal: allStages.length,
    stagesCurrent: currentStage ? allStages.findIndex(s => s.id === currentStage.id) + 1 : (inst.status === "completed" ? allStages.length : 0),
    transitions: transitions.map(t => ({
      ...t,
      actorName: actorMap.get(t.actorId),
      fromStageName: t.fromStageId ? stageMap.get(t.fromStageId) : null,
      toStageName: t.toStageId ? stageMap.get(t.toStageId) : null,
    })),
  };
}

// ─── Document status sync ─────────────────────────────────────────────────────

async function syncDocumentStatus(docId: number, newStatus: "under_review" | "approved" | "issued" | "draft") {
  try {
    await db.update(documentsTable)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(documentsTable.id, docId));
  } catch (_) {}
}

// ─── Workflow task lifecycle ───────────────────────────────────────────────────

async function closeOpenWorkflowTask(instanceId: number, closeStatus: "completed" | "cancelled") {
  try {
    await db.update(tasksTable)
      .set({
        status: closeStatus,
        completedAt: closeStatus === "completed" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tasksTable.sourceType, "workflow"),
        eq(tasksTable.sourceId, instanceId),
        or(eq(tasksTable.status, "pending"), eq(tasksTable.status, "in_progress")),
      ));
  } catch (_) {}
}

// ─── Notification helper: notify stage responsible when stage changes ──────────
async function notifyStageReached(
  inst: typeof wfInstancesTable.$inferSelect,
  stage: typeof wfTemplateStagesTable.$inferSelect,
  actorId: number,
  taskCloseStatus?: "completed" | "cancelled",
) {
  try {
    const [doc] = await db.select({ title: documentsTable.title, documentNumber: documentsTable.documentNumber })
      .from(documentsTable).where(eq(documentsTable.id, inst.documentId)).limit(1);
    const [tpl] = await db.select({ name: wfTemplatesTable.name }).from(wfTemplatesTable).where(eq(wfTemplatesTable.id, inst.templateId)).limit(1);
    const [actor] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
    const [proj] = inst.projectId
      ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, inst.projectId)).limit(1)
      : [null];
    const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";

    // ── Task lifecycle ────────────────────────────────────────────────────────
    // Close the previous stage's task (when advancing or returning to a stage)
    if (taskCloseStatus) {
      await closeOpenWorkflowTask(inst.id, taskCloseStatus);
    }
    // Create a new task only for explicitly assigned users — role-only stages
    // get notifications but no Task (no specific assignedToId to set).
    if (stage.responsibleUserId) {
      const docLabel = doc?.documentNumber ?? doc?.title ?? "Document";
      await db.insert(tasksTable).values({
        title: `[Action Required] ${stage.name}: ${docLabel}`,
        description: `Open the document to review and take action at the ${stage.name} stage.`,
        status: "pending",
        priority: "medium",
        assignedToId: stage.responsibleUserId,
        createdById: inst.initiatedById,
        projectId: inst.projectId ?? undefined,
        organizationId: inst.organizationId ?? undefined,
        sourceType: "workflow",
        sourceId: inst.id,
        dueDate: inst.stageDueAt ?? undefined,
        assignedAt: new Date(),
      }).catch(() => {});
    }

    // Resolve recipients:
    //   1. Specific assigned user
    //   2. All users whose system role matches responsibleRole (e.g. "reviewer")
    //   3. Fallback: all org admins + project_managers (for custom role strings like "GM", "Finance")
    let recipients: { userId: number; email: string; name: string }[] = [];
    if (stage.responsibleUserId) {
      const [u] = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(and(eq(usersTable.id, stage.responsibleUserId), eq(usersTable.organizationId, inst.organizationId))).limit(1);
      if (u) recipients = [{ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }];
    } else if (stage.responsibleRole && isValidAppRole(stage.responsibleRole)) {
      const roleUsers = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(and(
          eq(usersTable.organizationId, inst.organizationId),
          eq(usersTable.isActive, true),
          eq(usersTable.role, stage.responsibleRole as any),
        ));
      recipients = roleUsers.map(u => ({ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }));
      if (!recipients.length) {
        // No users with that exact role — escalate to admins/PMs
        const fallback = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable)
          .where(and(eq(usersTable.organizationId, inst.organizationId), eq(usersTable.isActive, true), inArray(usersTable.role, ["admin", "project_manager"])));
        recipients = fallback.map(u => ({ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }));
      }
    } else {
      const fallback = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(and(
          eq(usersTable.organizationId, inst.organizationId),
          eq(usersTable.isActive, true),
          inArray(usersTable.role, ["admin", "project_manager"]),
        ));
      recipients = fallback.map(u => ({ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }));
    }

    if (!recipients.length) return;

    // In-app notifications
    await db.insert(notificationsTable).values(recipients.map(r => ({
      userId: r.userId,
      type: "workflow_action_required" as const,
      title: `Workflow action needed: ${stage.name}`,
      message: `${doc?.documentNumber ?? ""} "${doc?.title ?? ""}" has reached the ${stage.name} stage and requires your action.`,
      entityType: "workflow",
      entityId: inst.id,
      actionUrl: `/workflow-engine`,
    }))).catch(() => {});

    // Email
    await dispatchNotification({
      event: "workflow_stage_reached",
      recipients,
      sendEmail: (to) => sendWorkflowStageEmail({
        to,
        stageName: stage.name,
        stageRole: stage.responsibleRole ?? undefined,
        documentTitle: doc?.title ?? "",
        documentNumber: doc?.documentNumber ?? "",
        workflowName: tpl?.name ?? "",
        submittedByName: actorName,
        projectName: proj?.name,
        instanceId: inst.id,
      }),
    });
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/templates", async (req, res): Promise<void> => {
  const org = orgId(req);
  const templates = await db.select().from(wfTemplatesTable)
    .where(eq(wfTemplatesTable.organizationId, org))
    .orderBy(desc(wfTemplatesTable.updatedAt));
  const enriched = await Promise.all(templates.map(async t => {
    const stages = await db.select().from(wfTemplateStagesTable)
      .where(eq(wfTemplateStagesTable.templateId, t.id))
      .orderBy(asc(wfTemplateStagesTable.stageOrder));
    return { ...t, stages };
  }));
  res.json({ templates: enriched });
});

router.get("/templates/:id", async (req, res): Promise<void> => {
  const tpl = await getTemplateWithStages(requireInt(req.params.id), orgId(req));
  if (!tpl) { res.status(404).json({ error: "Not found" }); return; }
  res.json(tpl);
});

router.post("/templates", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const { name, documentType, documentTypeId, description } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!documentType && !documentTypeId) { res.status(400).json({ error: "documentType or documentTypeId is required" }); return; }

  let resolvedDocumentType = documentType;
  let resolvedDocumentTypeId: number | null = null;
  if (documentTypeId != null) {
    const [docType] = await db.select().from(documentTypesTable)
      .where(and(eq(documentTypesTable.id, documentTypeId), eq(documentTypesTable.organizationId, org)));
    if (!docType) { res.status(400).json({ error: "documentTypeId does not exist for this organization" }); return; }
    resolvedDocumentTypeId = docType.id;
    resolvedDocumentType = docType.code;
  }

  try {
    const [tpl] = await db.insert(wfTemplatesTable).values({
      organizationId: org, name, documentType: resolvedDocumentType, documentTypeId: resolvedDocumentTypeId, description: description ?? null,
      isActive: true, createdById: req.user!.id,
    }).returning();
    res.status(201).json({ ...tpl, stages: [] });
  } catch (err: any) {
    logger.error({
      err,
      body: req.body,
      orgId: org,
      userId: req.user?.id,
      route: "POST /workflow-engine/templates",
      pgCode: err?.code,
      pgDetail: err?.detail,
      pgConstraint: err?.constraint,
    }, "Failed to create workflow template");
    res.status(500).json({
      error: "Failed to create workflow template",
      detail: err?.detail ?? err?.message ?? "Unknown error",
      code: err?.code ?? null,
      constraint: err?.constraint ?? null,
    });
  }
});

router.put("/templates/:id", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  const { name, documentType, documentTypeId, description, isActive } = req.body;

  let resolvedDocumentType = documentType;
  let resolvedDocumentTypeId: number | undefined;
  if (documentTypeId != null) {
    const [docType] = await db.select().from(documentTypesTable)
      .where(and(eq(documentTypesTable.id, documentTypeId), eq(documentTypesTable.organizationId, org)));
    if (!docType) { res.status(400).json({ error: "documentTypeId does not exist for this organization" }); return; }
    resolvedDocumentTypeId = docType.id;
    resolvedDocumentType = docType.code;
  }

  try {
    const [tpl] = await db.update(wfTemplatesTable)
      .set({ ...(name && { name }), ...(resolvedDocumentType && { documentType: resolvedDocumentType }), ...(resolvedDocumentTypeId !== undefined && { documentTypeId: resolvedDocumentTypeId }), ...(description !== undefined && { description }), ...(isActive !== undefined && { isActive }), updatedAt: new Date() })
      .where(and(eq(wfTemplatesTable.id, id), eq(wfTemplatesTable.organizationId, org)))
      .returning();
    if (!tpl) { res.status(404).json({ error: "Not found" }); return; }
    res.json(tpl);
  } catch (err: any) {
    logger.error({
      err, body: req.body, orgId: org, templateId: id,
      route: "PUT /workflow-engine/templates/:id",
      pgCode: err?.code, pgDetail: err?.detail, pgConstraint: err?.constraint,
    }, "Failed to update workflow template");
    res.status(500).json({
      error: "Failed to update workflow template",
      detail: err?.detail ?? err?.message ?? "Unknown error",
      code: err?.code ?? null,
      constraint: err?.constraint ?? null,
    });
  }
});

router.delete("/templates/:id", requireRole("admin", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  try {
    await db.delete(wfTemplatesTable).where(and(eq(wfTemplatesTable.id, id), eq(wfTemplatesTable.organizationId, org)));
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err, orgId: org, templateId: id, route: "DELETE /workflow-engine/templates/:id", pgCode: err?.code }, "Failed to delete workflow template");
    res.status(500).json({ error: "Failed to delete workflow template", detail: err?.detail ?? err?.message ?? "Unknown error", code: err?.code ?? null });
  }
});

// ─── Stages ───────────────────────────────────────────────────────────────────

router.post("/templates/:id/stages", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const templateId = requireInt(req.params.id);
  try {
    const [tpl] = await db.select().from(wfTemplatesTable)
      .where(and(eq(wfTemplatesTable.id, templateId), eq(wfTemplatesTable.organizationId, org))).limit(1);
    if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }

    const { name, description, responsibleRole, responsibleUserId, isTerminal, stageOrder, slaDays, reminderDays } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }

    // responsibleRole gates advance/reject via isAtLeast() — must be a real AppRole
    if (responsibleRole != null && !isValidAppRole(responsibleRole)) {
      res.status(400).json({ error: `responsibleRole must be one of: ${ALL_ROLES.join(", ")}` });
      return;
    }

    // Validate responsibleUserId belongs to same org
    if (responsibleUserId) {
      const [u] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.id, responsibleUserId), eq(usersTable.organizationId, org))).limit(1);
      if (!u) { res.status(400).json({ error: "responsibleUserId must belong to the same organization" }); return; }
    }

    // Default stageOrder to max+1
    const existing = await db.select({ stageOrder: wfTemplateStagesTable.stageOrder })
      .from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.templateId, templateId));
    const maxOrder = existing.length ? Math.max(...existing.map(s => s.stageOrder)) : 0;

    const [stage] = await db.insert(wfTemplateStagesTable).values({
      templateId, name, description: description ?? null, responsibleRole: responsibleRole ?? null,
      responsibleUserId: responsibleUserId ?? null,
      isTerminal: isTerminal ?? false, stageOrder: stageOrder ?? maxOrder + 1,
      slaDays: slaDays ?? null, reminderDays: reminderDays ?? null,
    }).returning();
    await db.update(wfTemplatesTable).set({ updatedAt: new Date() }).where(eq(wfTemplatesTable.id, templateId));
    res.status(201).json(stage);
  } catch (err: any) {
    logger.error({
      err,
      body: req.body,
      orgId: org,
      templateId,
      userId: req.user?.id,
      route: "POST /workflow-engine/templates/:id/stages",
      pgCode: err?.code,
      pgDetail: err?.detail,
      pgConstraint: err?.constraint,
    }, "Failed to create workflow template stage");
    res.status(500).json({
      error: "Failed to create workflow template stage",
      detail: err?.detail ?? err?.message ?? "Unknown error",
      code: err?.code ?? null,
      constraint: err?.constraint ?? null,
    });
  }
});

router.put("/templates/:id/stages/:stageId", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const templateId = requireInt(req.params.id);
  const stageId = requireInt(req.params.stageId);
  try {
    const [tpl] = await db.select().from(wfTemplatesTable)
      .where(and(eq(wfTemplatesTable.id, templateId), eq(wfTemplatesTable.organizationId, org))).limit(1);
    if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }

    const { name, description, responsibleRole, responsibleUserId, isTerminal, stageOrder, slaDays, reminderDays } = req.body;
    if (responsibleRole != null && !isValidAppRole(responsibleRole)) {
      res.status(400).json({ error: `responsibleRole must be one of: ${ALL_ROLES.join(", ")}` });
      return;
    }
    if (responsibleUserId) {
      const [u] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.id, responsibleUserId), eq(usersTable.organizationId, org))).limit(1);
      if (!u) { res.status(400).json({ error: "responsibleUserId must belong to the same organization" }); return; }
    }
    const [stage] = await db.update(wfTemplateStagesTable)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(responsibleRole !== undefined && { responsibleRole }),
        ...(responsibleUserId !== undefined && { responsibleUserId: responsibleUserId ?? null }),
        ...(isTerminal !== undefined && { isTerminal }),
        ...(stageOrder !== undefined && { stageOrder }),
        ...(slaDays !== undefined && { slaDays: slaDays ?? null }),
        ...(reminderDays !== undefined && { reminderDays: reminderDays ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(wfTemplateStagesTable.id, stageId), eq(wfTemplateStagesTable.templateId, templateId)))
      .returning();
    if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
    res.json(stage);
  } catch (err: any) {
    logger.error({
      err, body: req.body, orgId: org, templateId, stageId,
      route: "PUT /workflow-engine/templates/:id/stages/:stageId",
      pgCode: err?.code, pgDetail: err?.detail, pgConstraint: err?.constraint,
    }, "Failed to update workflow template stage");
    res.status(500).json({
      error: "Failed to update workflow template stage",
      detail: err?.detail ?? err?.message ?? "Unknown error",
      code: err?.code ?? null,
      constraint: err?.constraint ?? null,
    });
  }
});

router.delete("/templates/:id/stages/:stageId", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const templateId = requireInt(req.params.id);
  const stageId = requireInt(req.params.stageId);
  try {
    const [tpl] = await db.select().from(wfTemplatesTable)
      .where(and(eq(wfTemplatesTable.id, templateId), eq(wfTemplatesTable.organizationId, org))).limit(1);
    if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
    await db.delete(wfTemplateStagesTable)
      .where(and(eq(wfTemplateStagesTable.id, stageId), eq(wfTemplateStagesTable.templateId, templateId)));
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err, orgId: org, templateId, stageId, route: "DELETE /workflow-engine/templates/:id/stages/:stageId", pgCode: err?.code }, "Failed to delete workflow template stage");
    res.status(500).json({ error: "Failed to delete workflow template stage", detail: err?.detail ?? err?.message ?? "Unknown error", code: err?.code ?? null });
  }
});

// ─── Seed Invoice Template ────────────────────────────────────────────────────

router.post("/seed-invoice", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);

  // Idempotent: check if an Invoice template already exists for this org
  const [existing] = await db.select().from(wfTemplatesTable)
    .where(and(eq(wfTemplatesTable.organizationId, org), eq(wfTemplatesTable.documentType, "Invoice")))
    .limit(1);
  if (existing) {
    const stages = await db.select().from(wfTemplateStagesTable)
      .where(eq(wfTemplateStagesTable.templateId, existing.id))
      .orderBy(asc(wfTemplateStagesTable.stageOrder));
    res.json({ message: "Invoice template already exists", template: { ...existing, stages } });
    return;
  }

  const [tpl] = await db.insert(wfTemplatesTable).values({
    organizationId: org,
    name: "Invoice Approval Workflow",
    documentType: "Invoice",
    description: "Standard invoice approval: Finance → Contracts → Operations → GM → Issued",
    isActive: true,
    createdById: req.user!.id,
  }).returning();

  const stagesDef = [
    { stageOrder: 1, name: "Finance Review",     responsibleRole: "document_controller", isTerminal: false },
    { stageOrder: 2, name: "Contracts Review",   responsibleRole: "document_controller", isTerminal: false },
    { stageOrder: 3, name: "Operations Review",  responsibleRole: "document_controller", isTerminal: false },
    { stageOrder: 4, name: "GM Approval",        responsibleRole: "admin",               isTerminal: false },
    { stageOrder: 5, name: "Issued",             responsibleRole: null,                  isTerminal: true  },
  ];

  const stages = await db.insert(wfTemplateStagesTable)
    .values(stagesDef.map(s => ({ ...s, templateId: tpl.id, responsibleUserId: null })))
    .returning();

  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "wf_template", entityId: tpl.id, entityTitle: tpl.name });
  res.status(201).json({ template: { ...tpl, stages: stages.sort((a, b) => a.stageOrder - b.stageOrder) } });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/instances", async (req, res): Promise<void> => {
  const org = orgId(req);
  const { docType, status, projectId, stageId } = req.query;

  let instances = await db.select().from(wfInstancesTable)
    .where(eq(wfInstancesTable.organizationId, org))
    .orderBy(desc(wfInstancesTable.updatedAt));

  // In-memory filters (docType requires join — filter after enrich)
  if (status) instances = instances.filter(i => i.status === status);
  if (projectId) instances = instances.filter(i => i.projectId === parseInt(projectId as string));
  if (stageId) instances = instances.filter(i => i.currentStageId === parseInt(stageId as string));

  const roleCache = new Map<number | null, string>();
  const enriched = await Promise.all(instances.map(i => enrichInstance(i, req.user!, roleCache)));

  // docType filter (applied after enrichment)
  const filtered = docType ? enriched.filter(i => i.documentType === docType) : enriched;

  res.json({ instances: filtered, total: filtered.length });
});

router.get("/instances/:id", async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  const [inst] = await db.select().from(wfInstancesTable)
    .where(and(eq(wfInstancesTable.id, id), eq(wfInstancesTable.organizationId, org)))
    .limit(1);
  if (!inst) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await enrichInstance(inst, req.user!, new Map()));
});

router.post("/instances", async (req, res): Promise<void> => {
  const org = orgId(req);
  const { documentId, templateId, projectId } = req.body;
  if (!documentId || !templateId) { res.status(400).json({ error: "documentId and templateId are required" }); return; }

  // Verify document belongs to org
  const [doc] = await db.select().from(documentsTable)
    .where(and(eq(documentsTable.id, documentId), eq(documentsTable.organizationId, org))).limit(1);
  if (!doc) { res.status(404).json({ error: "Document not found or not in your organization" }); return; }

  // Verify template belongs to org
  const [tpl] = await db.select().from(wfTemplatesTable)
    .where(and(eq(wfTemplatesTable.id, templateId), eq(wfTemplatesTable.organizationId, org))).limit(1);
  if (!tpl) { res.status(404).json({ error: "Template not found or not in your organization" }); return; }

  // Check no active instance already exists for this document+template
  const [dup] = await db.select().from(wfInstancesTable)
    .where(and(eq(wfInstancesTable.documentId, documentId), eq(wfInstancesTable.templateId, templateId), eq(wfInstancesTable.status, "active")))
    .limit(1);
  if (dup) { res.status(409).json({ error: "An active workflow instance already exists for this document and template" }); return; }

  // First stage
  const [firstStage] = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.templateId, templateId))
    .orderBy(asc(wfTemplateStagesTable.stageOrder)).limit(1);

  const [inst] = await db.insert(wfInstancesTable).values({
    organizationId: org,
    documentId,
    templateId,
    projectId: projectId ?? doc.projectId ?? null,
    currentStageId: firstStage?.id ?? null,
    status: "active",
    initiatedById: req.user!.id,
    stageDueAt: computeStageDueAt(firstStage),
  }).returning();

  // Record "started" transition
  await db.insert(wfInstanceTransitionsTable).values({
    instanceId: inst.id, fromStageId: null, toStageId: firstStage?.id ?? null,
    action: "started", actorId: req.user!.id,
  });

  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "wf_instance", entityId: inst.id, entityTitle: doc.title });

  // Sync document status → under_review
  syncDocumentStatus(documentId, "under_review");
  await createAuditLog({
    userId: req.user!.id,
    action: "status_change",
    entityType: "document",
    entityId: documentId,
    entityTitle: doc.title,
    details: { toStatus: "under_review", via: "workflow_start", workflowInstanceId: inst.id },
  });

  // Notify stage responsible
  if (firstStage) notifyStageReached(inst, firstStage, req.user!.id);

  res.status(201).json(await enrichInstance(inst, req.user!, new Map()));
});

// ─── Advance to next stage ────────────────────────────────────────────────────

router.post("/instances/:id/advance", async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  const { comment } = req.body;

  const [inst] = await db.select().from(wfInstancesTable)
    .where(and(eq(wfInstancesTable.id, id), eq(wfInstancesTable.organizationId, org))).limit(1);
  if (!inst) { res.status(404).json({ error: "Not found" }); return; }
  if (inst.status !== "active") { res.status(409).json({ error: "Workflow is not active" }); return; }

  // Get all stages ordered
  const stages = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.templateId, inst.templateId))
    .orderBy(asc(wfTemplateStagesTable.stageOrder));

  const currentIdx = stages.findIndex(s => s.id === inst.currentStageId);
  const currentStage = stages[currentIdx];
  const nextStage = stages[currentIdx + 1] ?? null;

  // Authorization: only the stage's responsible user/role, or admin+ override, may advance.
  const { role: effectiveRole } = await resolveEffectiveRole(req.user!, inst.projectId ?? undefined);
  const basis = checkWorkflowStagePermission(effectiveRole, req.user!.id, currentStage ?? null);
  if (!basis) {
    res.status(403).json({ error: "Forbidden", message: "You are not authorized to advance this workflow at its current stage" });
    return;
  }
  if (basis === "admin_override") {
    await createAuditLog({
      userId: req.user!.id,
      organizationId: org,
      action: "workflow_admin_override_advance",
      entityType: "wf_instance",
      entityId: id,
      projectId: inst.projectId ?? undefined,
      details: {
        stageId: currentStage?.id ?? null,
        stageName: currentStage?.name ?? null,
        responsibleRole: currentStage?.responsibleRole ?? null,
        responsibleUserId: currentStage?.responsibleUserId ?? null,
      },
    });
  }

  let newStatus: string = inst.status;
  let newStageId: number | null = inst.currentStageId;

  if (currentStage?.isTerminal || !nextStage) {
    // Final stage advanced — workflow completes
    newStatus = "completed";
    newStageId = null;
  } else {
    newStageId = nextStage.id;
  }

  const [updated] = await db.update(wfInstancesTable)
    .set({
      currentStageId: newStageId,
      status: newStatus,
      // Compute new due date for the next stage; clear when workflow completes
      stageDueAt: newStatus === "active" && nextStage ? computeStageDueAt(nextStage) : null,
      updatedAt: new Date(),
    })
    .where(eq(wfInstancesTable.id, id))
    .returning();

  await db.insert(wfInstanceTransitionsTable).values({
    instanceId: id,
    fromStageId: inst.currentStageId,
    toStageId: newStageId,
    action: newStatus === "completed" ? "completed" : "advanced",
    actorId: req.user!.id,
    comment: comment ?? null,
  });

  await createAuditLog({ userId: req.user!.id, action: "workflow_advance", entityType: "wf_instance", entityId: id });

  // Sync document status when workflow completes
  if (newStatus === "completed") {
    const terminalName = currentStage?.name?.toLowerCase() ?? "";
    const docStatus = terminalName.includes("issued") ? "issued" : "approved";
    syncDocumentStatus(inst.documentId, docStatus);
    await createAuditLog({
      userId: req.user!.id,
      action: "status_change",
      entityType: "document",
      entityId: inst.documentId,
      details: { toStatus: docStatus, via: "workflow_completion", workflowInstanceId: id },
    });
  }

  // Task lifecycle + notification for next stage
  if (nextStage && newStatus === "active") {
    notifyStageReached(updated, nextStage, req.user!.id, "completed");
  } else if (newStatus === "completed") {
    // Workflow finished — close the final stage's task
    closeOpenWorkflowTask(id, "completed");
  }

  res.json(await enrichInstance(updated, req.user!, new Map()));
});

// ─── Reject (cancel or send back) ────────────────────────────────────────────

router.post("/instances/:id/reject", async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  const { comment, action: rejectAction = "rejected" } = req.body;

  const [inst] = await db.select().from(wfInstancesTable)
    .where(and(eq(wfInstancesTable.id, id), eq(wfInstancesTable.organizationId, org))).limit(1);
  if (!inst) { res.status(404).json({ error: "Not found" }); return; }
  if (inst.status !== "active") { res.status(409).json({ error: "Workflow is not active" }); return; }

  // Authorization: only the stage's responsible user/role, or admin+ override, may reject/return/cancel.
  const currentStage = await getCurrentStage(inst);
  const { role: effectiveRole } = await resolveEffectiveRole(req.user!, inst.projectId ?? undefined);
  const basis = checkWorkflowStagePermission(effectiveRole, req.user!.id, currentStage);
  if (!basis) {
    res.status(403).json({ error: "Forbidden", message: "You are not authorized to reject/return this workflow at its current stage" });
    return;
  }
  if (basis === "admin_override") {
    await createAuditLog({
      userId: req.user!.id,
      organizationId: org,
      action: "workflow_admin_override_reject",
      entityType: "wf_instance",
      entityId: id,
      projectId: inst.projectId ?? undefined,
      details: {
        stageId: currentStage?.id ?? null,
        stageName: currentStage?.name ?? null,
        responsibleRole: currentStage?.responsibleRole ?? null,
        responsibleUserId: currentStage?.responsibleUserId ?? null,
      },
    });
  }

  const finalAction = ["rejected", "cancelled", "returned"].includes(rejectAction) ? rejectAction : "rejected";
  const newStatus = finalAction === "returned" ? "active" : finalAction;

  // If returned, go back to previous stage
  let newStageId: number | null = inst.currentStageId;
  let returnStage: typeof wfTemplateStagesTable.$inferSelect | null = null;
  if (finalAction === "returned") {
    const stages = await db.select().from(wfTemplateStagesTable)
      .where(eq(wfTemplateStagesTable.templateId, inst.templateId))
      .orderBy(asc(wfTemplateStagesTable.stageOrder));
    const currentIdx = stages.findIndex(s => s.id === inst.currentStageId);
    returnStage = stages[currentIdx - 1] ?? stages[0] ?? null;
    newStageId = returnStage?.id ?? inst.currentStageId;
  } else {
    newStageId = null;
  }

  const [updated] = await db.update(wfInstancesTable)
    .set({
      currentStageId: newStageId,
      status: newStatus,
      // If returning to a previous stage, compute fresh SLA due date for that stage
      stageDueAt: finalAction === "returned" ? computeStageDueAt(returnStage) : null,
      updatedAt: new Date(),
    })
    .where(eq(wfInstancesTable.id, id))
    .returning();

  await db.insert(wfInstanceTransitionsTable).values({
    instanceId: id,
    fromStageId: inst.currentStageId,
    toStageId: newStageId,
    action: finalAction,
    actorId: req.user!.id,
    comment: comment ?? null,
  });

  await createAuditLog({ userId: req.user!.id, action: `workflow_${finalAction}`, entityType: "wf_instance", entityId: id });

  // Sync document status on hard reject or cancel; returned stays under_review
  if (finalAction === "rejected" || finalAction === "cancelled") {
    syncDocumentStatus(inst.documentId, "draft");
    await createAuditLog({
      userId: req.user!.id,
      action: "status_change",
      entityType: "document",
      entityId: inst.documentId,
      details: { toStatus: "draft", via: `workflow_${finalAction}`, workflowInstanceId: id },
    });
  }

  // Task lifecycle: on return, close current task + create new one for the return stage;
  // on reject/cancel, close current task as cancelled.
  if (finalAction === "returned" && returnStage) {
    notifyStageReached(updated, returnStage, req.user!.id, "cancelled");
  } else {
    closeOpenWorkflowTask(id, "cancelled");
  }

  res.json(await enrichInstance(updated, req.user!, new Map()));
});


// ─── Duplicate template ───────────────────────────────────────────────────────

router.post("/templates/:id/duplicate", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  const id = requireInt(req.params.id);
  const [orig] = await db.select().from(wfTemplatesTable)
    .where(and(eq(wfTemplatesTable.id, id), eq(wfTemplatesTable.organizationId, org))).limit(1);
  if (!orig) { res.status(404).json({ error: "Template not found" }); return; }

  const stages = await db.select().from(wfTemplateStagesTable)
    .where(eq(wfTemplateStagesTable.templateId, id))
    .orderBy(asc(wfTemplateStagesTable.stageOrder));

  const [copy] = await db.insert(wfTemplatesTable).values({
    organizationId: org,
    name: `${orig.name} (Copy)`,
    documentType: orig.documentType,
    description: orig.description,
    isActive: false,
    createdById: req.user!.id,
  }).returning();

  if (stages.length) {
    await db.insert(wfTemplateStagesTable).values(
      stages.map(s => ({
        templateId: copy.id,
        name: s.name,
        description: s.description,
        responsibleRole: s.responsibleRole,
        responsibleUserId: null,
        isTerminal: s.isTerminal,
        stageOrder: s.stageOrder,
      })),
    );
  }

  res.status(201).json(await getTemplateWithStages(copy.id, org));
});

// ─── Get template(s) for a document type ─────────────────────────────────────

router.get("/templates/for-type/:docType", async (req, res): Promise<void> => {
  const org = orgId(req);
  const { docType } = req.params;
  // Case-insensitive match against documentType
  const templates = await db.select().from(wfTemplatesTable)
    .where(and(eq(wfTemplatesTable.organizationId, org), eq(wfTemplatesTable.isActive, true)));
  const matched = templates.filter(t => t.documentType.toLowerCase() === docType.toLowerCase());
  const enriched = await Promise.all(matched.map(async t => {
    const stages = await db.select().from(wfTemplateStagesTable)
      .where(eq(wfTemplateStagesTable.templateId, t.id))
      .orderBy(asc(wfTemplateStagesTable.stageOrder));
    return { ...t, stages };
  }));
  res.json({ templates: enriched });
});

// ─── Get instances for a specific document ───────────────────────────────────

router.get("/instances/for-document/:docId", async (req, res): Promise<void> => {
  const org = orgId(req);
  const docId = requireInt(req.params.docId);
  const instances = await db.select().from(wfInstancesTable)
    .where(and(eq(wfInstancesTable.documentId, docId), eq(wfInstancesTable.organizationId, org)))
    .orderBy(desc(wfInstancesTable.updatedAt));
  const roleCache = new Map<number | null, string>();
  const enriched = await Promise.all(instances.map(i => enrichInstance(i, req.user!, roleCache)));
  res.json({ instances: enriched });
});

// ─── Seed Default Templates ───────────────────────────────────────────────────

router.post("/seed-defaults", requireRole("admin", "project_manager", "system_owner"), async (req, res): Promise<void> => {
  const org = orgId(req);
  if (!org) {
    res.status(400).json({ error: "No organization context. Pass ?orgOverride=<id> as system_owner." });
    return;
  }
  const userId = req.user!.id;

  const defaults: Array<{
    name: string;
    documentType: string;
    description: string;
    stages: Array<{ stageOrder: number; name: string; responsibleRole: string | null; isTerminal: boolean }>;
  }> = [
    {
      name: "General Document Approval",
      documentType: "general",
      description: "Standard approval for general documents",
      stages: [
        { stageOrder: 1, name: "Internal Review",     responsibleRole: "reviewer",            isTerminal: false },
        { stageOrder: 2, name: "Senior Review",        responsibleRole: "document_controller", isTerminal: false },
        { stageOrder: 3, name: "Approved for Issue",   responsibleRole: null,                  isTerminal: true  },
      ],
    },
    {
      name: "Correspondence Workflow",
      documentType: "correspondence",
      description: "Action tracking for incoming and outgoing correspondence",
      stages: [
        { stageOrder: 1, name: "Acknowledged",      responsibleRole: "document_controller", isTerminal: false },
        { stageOrder: 2, name: "Manager Review",    responsibleRole: "project_manager",      isTerminal: false },
        { stageOrder: 3, name: "Actioned",          responsibleRole: null,                   isTerminal: true  },
      ],
    },
    {
      name: "Contract Approval Workflow",
      documentType: "contract",
      description: "Multi-stage approval for contracts and agreements",
      stages: [
        { stageOrder: 1, name: "Legal Review",          responsibleRole: "document_controller", isTerminal: false },
        { stageOrder: 2, name: "Commercial Review",     responsibleRole: "document_controller", isTerminal: false },
        { stageOrder: 3, name: "Management Approval",   responsibleRole: "project_manager",     isTerminal: false },
        { stageOrder: 4, name: "Executed",              responsibleRole: null,                  isTerminal: true  },
      ],
    },
    {
      name: "Drawing Approval Workflow",
      documentType: "drawing",
      description: "Engineering review and approval for drawings",
      stages: [
        { stageOrder: 1, name: "Checker Review",              responsibleRole: "reviewer",            isTerminal: false },
        { stageOrder: 2, name: "Senior Engineer Review",      responsibleRole: "document_controller", isTerminal: false },
        { stageOrder: 3, name: "Approved for Construction",   responsibleRole: null,                  isTerminal: true  },
      ],
    },
  ];

  try {
    const results: Array<{ documentType: string; status: "created" | "already_exists"; templateName: string }> = [];

    for (const def of defaults) {
      const [existing] = await db.select().from(wfTemplatesTable)
        .where(and(eq(wfTemplatesTable.organizationId, org), eq(wfTemplatesTable.documentType, def.documentType)))
        .limit(1);

      if (existing) {
        results.push({ documentType: def.documentType, status: "already_exists", templateName: existing.name });
        continue;
      }

      const [tpl] = await db.insert(wfTemplatesTable).values({
        organizationId: org, name: def.name, documentType: def.documentType,
        description: def.description, isActive: true, createdById: userId,
      }).returning();

      await db.insert(wfTemplateStagesTable).values(
        def.stages.map(s => ({ ...s, templateId: tpl.id, responsibleUserId: null })),
      );

      await createAuditLog({ userId, action: "create", entityType: "wf_template", entityId: tpl.id, entityTitle: tpl.name });
      results.push({ documentType: def.documentType, status: "created", templateName: tpl.name });
    }

    // Return full template list after seeding
    const allTemplates = await db.select().from(wfTemplatesTable)
      .where(eq(wfTemplatesTable.organizationId, org));
    const enriched = await Promise.all(allTemplates.map(async t => {
      const stages = await db.select().from(wfTemplateStagesTable)
        .where(eq(wfTemplateStagesTable.templateId, t.id))
        .orderBy(asc(wfTemplateStagesTable.stageOrder));
      return { ...t, stages };
    }));

    res.status(201).json({ results, templates: enriched });
  } catch (err: any) {
    logger.error({
      err,
      orgId: org,
      userId,
      route: "POST /workflow-engine/seed-defaults",
      pgCode: err?.code,
      pgDetail: err?.detail,
      pgConstraint: err?.constraint,
    }, "Failed to seed default workflow templates");
    res.status(500).json({
      error: "Failed to seed default workflow templates",
      detail: err?.detail ?? err?.message ?? "Unknown error",
      code: err?.code ?? null,
      constraint: err?.constraint ?? null,
    });
  }
});

export default router;

