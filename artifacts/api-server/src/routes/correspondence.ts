import { Router } from "express";
import { db } from "@workspace/db";
import {
  correspondenceTable,
  correspondenceRecipientsTable,
  correspondenceCcTable,
  correspondenceAttachmentsTable,
  correspondenceSequencesTable,
  correspondenceTypeEnum,
  usersTable,
  projectsTable,
  projectMembersTable,
  notificationsTable,
  tasksTable,
} from "@workspace/db";
import { eq, and, or, asc, desc, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { requireAuth, hashPassword, isSysAdmin, isSystemOwner, hashToken } from "../lib/auth.js";
import { orgScopedWhere } from "../lib/org-scope.js";
import { hasMinRole } from "../middlewares/require-role.js";
import { createAuditLog } from "../lib/audit.js";
import { resolveEffectiveRole } from "../lib/governance.js";
import { CorrespondencePermissions } from "../lib/permissions.js";
import crypto from "crypto";
import { evaluateRules } from "../lib/rule-engine.js";
import { sendCorrespondenceDeliveryEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import { dispatchClassificationBackground } from "../lib/ai/classification-events.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { scheduleNotification } from "../lib/notifications/scheduler.js";
import { organizationsTable } from "@workspace/db";
import type { Request } from 'express';
import {param, paramInt, requireInt, type ProjectParams, type ProjectItemParams} from '../lib/params';
import { z } from "zod";
import { parseBody } from "../lib/validate.js";

// ─── Validation schema ────────────────────────────────────────────────────────
// Validates the fields most likely to cause DB errors or security issues.
// Uses .passthrough() so all other body fields reach createCorrespondence unchanged.

const createCorrespondenceSchema = z.object({
  subject:   z.string().min(1, "subject is required").max(500),
  // type MUST be a member of the correspondence_type DB enum. Previously this was a
  // free z.string(), so any non-enum value (e.g. wrong-case "RFI") reached the INSERT
  // and produced a 500 that leaked the SQL/schema. Constrain here → clean 400.
  type:      z.enum(correspondenceTypeEnum.enumValues),
  toUserIds: z.array(z.number().int().positive(), { message: "toUserIds must be an array of integers" }).optional(),
  ccUserIds: z.array(z.number().int().positive()).optional(),
  direction: z.enum(["incoming", "outgoing"]).optional(),
}).passthrough();

const router = Router({ mergeParams: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enrichCorrespondence(items: (typeof correspondenceTable.$inferSelect)[], viewerId?: number) {
  if (items.length === 0) return [];

  const itemIds = items.map(i => i.id);

  const recipients = await db.select({
    corrId: correspondenceRecipientsTable.correspondenceId,
    userId: correspondenceRecipientsTable.userId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
  }).from(correspondenceRecipientsTable)
    .leftJoin(usersTable, eq(correspondenceRecipientsTable.userId, usersTable.id))
    .where(inArray(correspondenceRecipientsTable.correspondenceId, itemIds));

  const ccRows = await db.select({
    corrId: correspondenceCcTable.correspondenceId,
    userId: correspondenceCcTable.userId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
  }).from(correspondenceCcTable)
    .leftJoin(usersTable, eq(correspondenceCcTable.userId, usersTable.id))
    .where(inArray(correspondenceCcTable.correspondenceId, itemIds));

  const attachments = await db.select({
    id: correspondenceAttachmentsTable.id,
    correspondenceId: correspondenceAttachmentsTable.correspondenceId,
    fileName: correspondenceAttachmentsTable.fileName,
    fileUrl: correspondenceAttachmentsTable.fileUrl,
    fileSize: correspondenceAttachmentsTable.fileSize,
    uploadedAt: correspondenceAttachmentsTable.uploadedAt,
  }).from(correspondenceAttachmentsTable)
    .where(inArray(correspondenceAttachmentsTable.correspondenceId, itemIds));

  const fromUserIds = [...new Set(items.map(i => i.fromUserId))];
  const fromUsers = fromUserIds.length > 0
    ? await db.select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      }).from(usersTable).where(inArray(usersTable.id, fromUserIds))
    : [];
  const fromUserMap = new Map(fromUsers.map(u => [u.id, u]));

  const recipientMap = new Map<number, { ids: number[]; names: string[]; emails: string[] }>();
  for (const r of recipients) {
    if (!recipientMap.has(r.corrId)) recipientMap.set(r.corrId, { ids: [], names: [], emails: [] });
    const entry = recipientMap.get(r.corrId)!;
    entry.ids.push(r.userId);
    if (r.firstName) {
      entry.names.push(`${r.firstName} ${r.lastName}`);
      entry.emails.push(r.email!);
    }
  }

  const ccMap = new Map<number, { ids: number[]; names: string[]; emails: string[] }>();
  for (const r of ccRows) {
    if (!ccMap.has(r.corrId)) ccMap.set(r.corrId, { ids: [], names: [], emails: [] });
    const entry = ccMap.get(r.corrId)!;
    entry.ids.push(r.userId);
    if (r.firstName) {
      entry.names.push(`${r.firstName} ${r.lastName}`);
      entry.emails.push(r.email!);
    }
  }

  const attachmentMap = new Map<number, typeof attachments>();
  for (const a of attachments) {
    if (!attachmentMap.has(a.correspondenceId)) attachmentMap.set(a.correspondenceId, []);
    attachmentMap.get(a.correspondenceId)!.push(a);
  }

  return items.map(item => {
    const fromUser = fromUserMap.get(item.fromUserId);
    const recs = recipientMap.get(item.id) || { ids: [], names: [], emails: [] };
    const ccs = ccMap.get(item.id) || { ids: [], names: [], emails: [] };
    const atts = attachmentMap.get(item.id) || [];
    // Viewer-relative direction/folder. A correspondence is "outgoing/sent" for its
    // sender but "incoming/inbox" for its recipients (To/CC). The stored direction/folder
    // are the sender's perspective; recompute per current viewer so recipients see the
    // item in their Inbox — not Outgoing. When no viewer is given, keep stored values.
    const isSenderView = viewerId != null && item.fromUserId === viewerId;
    const isRecipientView = viewerId != null && (recs.ids.includes(viewerId) || ccs.ids.includes(viewerId));
    const viewerFolder = isSenderView ? item.folder : (isRecipientView ? "inbox" : item.folder);
    const viewerDirection = isSenderView ? "outgoing" : (isRecipientView ? "incoming" : item.direction);
    return {
      ...item,
      folder: viewerFolder,
      direction: viewerDirection,
      fromUserName: fromUser ? `${fromUser.firstName} ${fromUser.lastName}` : undefined,
      fromUserEmail: fromUser?.email,
      toUserIds: recs.ids,
      toUserNames: recs.names,
      toUserEmails: recs.emails,
      ccUserIds: ccs.ids,
      ccUserNames: ccs.names,
      ccUserEmails: ccs.emails,
      attachments: atts.map(a => ({ id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize, uploadedAt: a.uploadedAt })),
    };
  });
}

/**
 * Generate or validate a correspondence reference number.
 */
async function resolveReferenceNumber(opts: {
  orgId: number;
  scope: string;
  projectId?: number | null;
  manualRef?: string | null;
}): Promise<{ refNum: string; error?: string }> {
  const { orgId, scope, projectId, manualRef } = opts;

  if (manualRef?.trim()) {
    const trimmed = manualRef.trim();
    const duplicate = await db
      .select({ id: correspondenceTable.id })
      .from(correspondenceTable)
      .where(
        and(
          eq(correspondenceTable.organizationId, orgId),
          eq(correspondenceTable.referenceNumber, trimmed)
        )
      )
      .limit(1);
    if (duplicate.length > 0) {
      return { refNum: "", error: `Reference number "${trimmed}" already exists in this organization.` };
    }
    return { refNum: trimmed };
  }

  const year = new Date().getFullYear();

  const nextSeq = await db.transaction(async (tx) => {
    const conds = [
      eq(correspondenceSequencesTable.organizationId, orgId),
      eq(correspondenceSequencesTable.scope, scope),
      eq(correspondenceSequencesTable.year, year),
      projectId
        ? eq(correspondenceSequencesTable.projectId, projectId)
        : isNull(correspondenceSequencesTable.projectId),
    ];

    const existing = await tx
      .select()
      .from(correspondenceSequencesTable)
      .where(and(...conds))
      .limit(1)
      .for("update");

    if (existing.length === 0) {
      await tx.insert(correspondenceSequencesTable).values({
        organizationId: orgId,
        scope,
        projectId: projectId ?? null,
        year,
        lastSeq: 1,
        updatedAt: new Date(),
      });
      return 1;
    }

    const next = existing[0].lastSeq + 1;
    await tx
      .update(correspondenceSequencesTable)
      .set({ lastSeq: next, updatedAt: new Date() })
      .where(eq(correspondenceSequencesTable.id, existing[0].id));
    return next;
  });

  const seqStr = String(nextSeq).padStart(4, "0");

  if (scope === "internal") {
    return { refNum: `INT-${year}-${seqStr}` };
  }

  if (projectId) {
    const [proj] = await db
      .select({ code: projectsTable.code })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const code = proj?.code ?? "PROJ";
    return { refNum: `${code}-${year}-${seqStr}` };
  }

  return { refNum: `CORR-${year}-${seqStr}` };
}

// ─── Shared create logic ───────────────────────────────────────────────────────

async function createCorrespondence(
  req: any,
  res: any,
  contextProjectId: number | null
) {
  const caller = req.user!;

  // Resolve effective role (db) — short read tx under the marker.
  const { role: effectiveRole } = await tenantRead(() => resolveEffectiveRole(caller, contextProjectId ?? undefined));
  if (!CorrespondencePermissions.canCreate(effectiveRole)) {
    res.status(403).json({ error: "Forbidden", message: "You do not have permission to create correspondence" });
    return;
  }

  const {
    subject,
    type,
    body,
    toUserIds,
    ccUserIds,
    sendNow,
    priority,
    dueDate,
    taskToId,
    attachments,
    referenceNumber: manualRef,
    scope: rawScope,
    projectId: bodyProjectId,
    direction,
    requiresResponse: rawRequiresResponse,
  } = req.body;

  const requiresResponse = rawRequiresResponse === true || rawRequiresResponse === "true";

  const effectiveProjectIdForOrg: number | null =
    contextProjectId ?? (bodyProjectId ? parseInt(bodyProjectId) : null);

  // Determine org context (system_owner may derive it from the project — db read).
  let orgId: number | undefined =
    caller.organizationId ??
    (isSystemOwner(caller) && req.body.organizationId ? parseInt(req.body.organizationId) : undefined);

  if (!orgId && isSystemOwner(caller) && effectiveProjectIdForOrg) {
    const [proj] = await tenantRead(() => db
      .select({ organizationId: projectsTable.organizationId })
      .from(projectsTable)
      .where(eq(projectsTable.id, effectiveProjectIdForOrg))
      .limit(1));
    orgId = proj?.organizationId ?? undefined;
  }

  if (!orgId) {
    res.status(400).json({
      error: "No organization context",
      message: isSystemOwner(caller)
        ? "Select a project first — the organization context will be derived from the project."
        : "Your account is not assigned to an organization. Contact your administrator.",
    });
    return;
  }
  if (!subject?.trim()) { res.status(400).json({ error: "subject is required" }); return; }
  if (!type) { res.status(400).json({ error: "type is required" }); return; }

  const effectiveProjectId: number | null =
    contextProjectId ?? (bodyProjectId ? parseInt(bodyProjectId) : null);

  const scope: string =
    contextProjectId !== null
      ? "project"
      : (rawScope === "internal" || rawScope === "project" ? rawScope : "project");

  if (scope === "project" && !effectiveProjectId) {
    res.status(400).json({ error: "projectId is required for project-scoped correspondence" });
    return;
  }

  // ─── Business unit-of-work: refNumber + corr + recipients/cc/attachments + audit ───
  const biz = await withTenant(async () => {
    const { refNum, error: refError } = await resolveReferenceNumber({
      orgId: orgId!,
      scope,
      projectId: scope === "project" ? effectiveProjectId : null,
      manualRef,
    });
    if (refError) return { kind: "refError" as const, error: refError };

    const [corr] = await db.insert(correspondenceTable).values({
      subject: subject.trim(),
      type,
      body: body || "",
      organizationId: orgId,
      fromUserId: req.user!.id,
      projectId: effectiveProjectId,
      scope,
      folder: sendNow ? "sent" : "draft",
      status: sendNow ? "sent" : "draft",
      referenceNumber: refNum,
      sentAt: sendNow ? new Date() : undefined,
      priority: priority || "medium",
      dueDate: dueDate ? new Date(dueDate) : undefined,
      assignedToId: taskToId ? parseInt(taskToId) : undefined,
      direction: direction === "incoming" || direction === "outgoing" ? direction : null,
      requiresResponse,
    }).returning();

    if (toUserIds?.length > 0) {
      await db.insert(correspondenceRecipientsTable).values(
        (toUserIds as number[]).map((uid: number) => ({ correspondenceId: corr.id, userId: uid }))
      );
    }
    if (ccUserIds?.length > 0) {
      await db.insert(correspondenceCcTable).values(
        (ccUserIds as number[]).map((uid: number) => ({ correspondenceId: corr.id, userId: uid }))
      );
    }
    if (attachments?.length > 0) {
      await db.insert(correspondenceAttachmentsTable).values(
        attachments.map((a: { fileName: string; fileUrl: string; fileSize?: number }) => ({
          correspondenceId: corr.id,
          fileName: a.fileName,
          fileUrl: a.fileUrl,
          fileSize: a.fileSize,
        }))
      );
    }

    await createAuditLog({
      userId: req.user!.id,
      action: "create",
      entityType: "correspondence",
      entityId: corr.id,
      entityTitle: corr.subject,
      projectId: effectiveProjectId ?? undefined,
    });
    return { kind: "ok" as const, corr };
  });

  if (biz.kind === "refError") { res.status(409).json({ error: biz.error }); return; }
  const corr = biz.corr;

  // ─── Post-commit side effects (each in its correct boundary; no business tx held) ───

  // AI classification — explicit background boundary (AI I/O, detached from ALS).
  dispatchClassificationBackground(
    { organizationId: orgId, userId: req.user!.id, itemType: "correspondence", itemId: corr.id },
    { subject: corr.subject, body: corr.body },
  );

  // Rule evaluation — DB-only subsystem → its own short tenant tx (best-effort).
  try {
    await withTenant(() => evaluateRules({
      type: "correspondence",
      orgId: orgId!,
      projectId: effectiveProjectId ?? 0,
      subject: corr.subject,
      senderUserId: req.user!.id,
      entityId: corr.id,
      entityTitle: corr.subject,
      triggeredByUserId: req.user!.id,
    }));
  } catch (_) {}

  // ─── Delivery: in-app notifications (RLS, short tx) + email (post-commit) ──────
  if (sendNow) {
    const toSet = new Set<number>((toUserIds as number[] ?? []));
    const ccDeduped = (ccUserIds as number[] ?? []).filter(id => !toSet.has(id));
    const allDeliveryIds = [...toSet, ...ccDeduped];
    if (allDeliveryIds.length > 0) {
      try {
        const bundle = await withTenant(async () => {
          const [sender] = await db
            .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
            .from(usersTable)
            .where(eq(usersTable.id, req.user!.id));
          const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "Someone";
          const senderEmail = sender?.email ?? "";

          const allRecipientUsers = await db
            .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
            .from(usersTable)
            .where(inArray(usersTable.id, allDeliveryIds));

          const project = effectiveProjectId
            ? (await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, effectiveProjectId)).limit(1))[0]
            : null;

          const toUsers = allRecipientUsers.filter(u => (toUserIds as number[] ?? []).includes(u.id));
          const ccUsers = allRecipientUsers.filter(u => (ccUserIds as number[] ?? []).includes(u.id));

          // In-app notifications for To recipients (RLS table — inside the tx)
          await db.insert(notificationsTable).values(
            (toUserIds as number[] ?? []).map((uid: number) => ({
              userId: uid,
              type: "correspondence_received" as const,
              title: `New correspondence: ${corr.subject}`,
              message: `${senderName} sent you a ${corr.type} — ${corr.subject}`,
              projectId: effectiveProjectId,
              entityType: "correspondence",
              entityId: corr.id,
              actionUrl: `/correspondence?openCorr=${corr.id}`,
            }))
          );
          return { senderName, senderEmail, allRecipientUsers, project, toUsers, ccUsers };
        });

        // Email delivery — OUTSIDE any tenant tx (notification subsystem + network).
        await dispatchNotification({
          event: "correspondence.delivered",
          mandatory: true,
          recipients: bundle.allRecipientUsers.map(r => ({ userId: r.id, email: r.email, name: `${r.firstName} ${r.lastName}`.trim() })),
          sendEmail: async (toEmails) => {
            const toEmailSet = new Set(bundle.toUsers.map(u => u.email));
            const ccEmailSet = new Set(bundle.ccUsers.map(u => u.email));
            const toNames = bundle.toUsers.map(u => `${u.firstName} ${u.lastName}`.trim());
            const ccNames = bundle.ccUsers.map(u => `${u.firstName} ${u.lastName}`.trim());
            await sendCorrespondenceDeliveryEmail({
              to: toEmails.filter(e => toEmailSet.has(e)),
              cc: toEmails.filter(e => ccEmailSet.has(e)),
              senderName: bundle.senderName,
              senderEmail: bundle.senderEmail,
              toNames,
              ccNames,
              subject: corr.subject,
              correspondenceType: corr.type,
              referenceNumber: corr.referenceNumber ?? undefined,
              priority: corr.priority ?? undefined,
              projectName: bundle.project?.name,
              bodyPreview: corr.body?.substring(0, 300),
              correspondenceId: corr.id,
              projectId: effectiveProjectId ?? undefined,
            });
          },
          entityType: "correspondence",
          entityId: corr.id,
          organizationId: orgId,
        });
      } catch (_) {}
    }
  }

  // ─── SLA / reminder scheduling — DB writes → short tenant tx (best-effort) ──────
  if (sendNow && requiresResponse && toUserIds?.length > 0) {
    try {
      await withTenant(async () => {
        const [org] = await db
          .select({
            corrUnreadReminderHours: organizationsTable.corrUnreadReminderHours,
            corrNoResponseHours:     organizationsTable.corrNoResponseHours,
            corrSlaDueSoonHours:     organizationsTable.corrSlaDueSoonHours,
          })
          .from(organizationsTable)
          .where(eq(organizationsTable.id, orgId!))
          .limit(1);

        const unreadHours  = org?.corrUnreadReminderHours ?? 48;
        const noRespHours  = org?.corrNoResponseHours     ?? 72;
        const dueSoonHours = org?.corrSlaDueSoonHours     ?? 24;
        const sentAt       = corr.sentAt ?? new Date();
        const dueDateObj   = dueDate ? new Date(dueDate) : null;
        const now          = new Date();

        const meta = {
          subject:          corr.subject,
          referenceNumber:  corr.referenceNumber ?? undefined,
          correspondenceId: corr.id,
          link:             `/correspondence?openCorr=${corr.id}`,
        };

        for (const uid of (toUserIds as number[])) {
          await scheduleNotification({
            eventKey: "correspondence.unread_reminder",
            fireAt: new Date(sentAt.getTime() + unreadHours * 60 * 60 * 1000),
            targetUserId: uid, entityType: "correspondence", entityId: corr.id,
            organizationId: orgId!, projectId: effectiveProjectId ?? undefined, metadata: meta,
          });
          const noRespAt = dueDateObj ?? new Date(sentAt.getTime() + noRespHours * 60 * 60 * 1000);
          await scheduleNotification({
            eventKey: "correspondence.no_response",
            fireAt: noRespAt,
            targetUserId: uid, entityType: "correspondence", entityId: corr.id,
            organizationId: orgId!, projectId: effectiveProjectId ?? undefined, metadata: meta,
          });
          if (dueDateObj && dueDateObj > now) {
            const dueSoonAt = new Date(dueDateObj.getTime() - dueSoonHours * 60 * 60 * 1000);
            if (dueSoonAt > now) {
              await scheduleNotification({
                eventKey: "sla.due_soon", fireAt: dueSoonAt,
                targetUserId: uid, entityType: "correspondence", entityId: corr.id,
                organizationId: orgId!, projectId: effectiveProjectId ?? undefined,
                metadata: { ...meta, title: corr.subject, dueDate: dueDateObj.toISOString() },
              });
            }
            await scheduleNotification({
              eventKey: "sla.breached", fireAt: dueDateObj,
              targetUserId: uid, entityType: "correspondence", entityId: corr.id,
              organizationId: orgId!, projectId: effectiveProjectId ?? undefined,
              metadata: { ...meta, title: corr.subject, dueDate: dueDateObj.toISOString() },
            });
          }
        }
      });
    } catch (schedErr: any) {
      console.warn("[correspondence] Failed to schedule reminders:", schedErr?.message);
    }
  }

  // ─── Create linked Task when Task To is set and correspondence is sent ────────
  if (sendNow && corr.assignedToId) {
    try {
      await withTenant(async () => {
        const [existingTask] = await db.select({ id: tasksTable.id })
          .from(tasksTable)
          .where(and(eq(tasksTable.sourceType, "correspondence"), eq(tasksTable.sourceId, corr.id)))
          .limit(1);
        if (!existingTask) {
          await db.insert(tasksTable).values({
            title: `[Action Required] ${corr.subject}`,
            description: corr.referenceNumber ? `Ref: ${corr.referenceNumber}` : undefined,
            status: "pending",
            priority: (corr.priority as any) ?? "medium",
            assignedToId: corr.assignedToId ?? undefined,
            createdById: corr.fromUserId,
            projectId: corr.projectId ?? undefined,
            organizationId: corr.organizationId ?? undefined,
            sourceType: "correspondence",
            sourceId: corr.id,
            dueDate: corr.dueDate ?? undefined,
            assignedAt: new Date(),
          });
        }
      });
    } catch (taskErr: any) {
      console.warn("[correspondence] Failed to create linked task:", taskErr?.message);
    }
  }

  const enriched = await withTenant(() => enrichCorrespondence([corr], req.user!.id));
  res.status(201).json(enriched[0]);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// ─── Correspondence items assigned to me (Task To) ────────────────────────────
router.get("/assigned-to-me", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId  = req.user!.organizationId;

  const enriched = await tenantRead(async () => {
    const items = await db.select().from(correspondenceTable)
      .where(and(
        eq(correspondenceTable.organizationId, orgId!),
        eq(correspondenceTable.assignedToId, userId),
        sql`${correspondenceTable.status} NOT IN ('closed')`,
      ))
      .orderBy(asc(correspondenceTable.dueDate), desc(correspondenceTable.updatedAt));
    return enrichCorrespondence(items, userId);
  });
  res.json({ items: enriched, total: enriched.length });
});

router.get("/", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = req.params.projectId ? requireInt(req.params.projectId) : null;
  const { folder, type, scope, viewAll } = req.query;
  const caller = req.user!;
  const userId = caller.id;
  const orgId = caller.organizationId;

  const out = await tenantRead(async (): Promise<{ status: number; body: unknown }> => {
  // Party-scoped project access: same-org users always allowed; cross-org users
  // must be explicit project members. Cross-org members get mail-model only (no viewAll).
  let isCrossOrgMember = false;
  if (projectId !== null && !isSystemOwner(caller)) {
    const [projCheck] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!projCheck) { return { status: 404, body: { error: "Not Found" } }; }
    if (projCheck.organizationId !== orgId) {
      // Cross-org caller: must be an explicit project member
      const [membership] = await db.select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, caller.id)))
        .limit(1);
      if (!membership) {
        return { status: 403, body: { error: "Forbidden", message: "You are not a member of this project" } };
      }
      isCrossOrgMember = true;
    }
  }

  // Resolve effective role (respects overrides, delegations, project member roles)
  const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId ?? undefined);

  // Hierarchical visibility policy:
  //   system_owner → all orgs (handled via orgId scope)
  //   admin        → all correspondence in org automatically (no opt-in required)
  //   PM / DC      → all correspondence in project (opt-in via viewAll=true)
  //   participant  → only To/CC (default mail-model)
  const isAdminLevel = hasMinRole(caller, "admin");

  // viewAll=true: PM/DC opt-in to see all project correspondence (not just own To/CC)
  // admin+ always see all correspondence in scope (no opt-in required)
  // Cross-org project members are always restricted to mail-model (To/CC only) — no viewAll.
  let wantsViewAll =
    isAdminLevel ||
    (viewAll === "true" && projectId !== null && CorrespondencePermissions.hasViewAllCapability(effectiveRole));
  if (isCrossOrgMember) wantsViewAll = false;

  const baseFilter = projectId !== null
    ? and(
        eq(correspondenceTable.organizationId, orgId!),
        eq(correspondenceTable.projectId, projectId)
      )
    : and(
        eq(correspondenceTable.organizationId, orgId!),
        or(
          isNull(correspondenceTable.projectId),
          eq(correspondenceTable.scope, "internal")
        )
      );

  // Build SQL conditions for optional query-param filters (B-3-2)
  const extraConds: SQL[] = [];
  if (folder) extraConds.push(eq(correspondenceTable.folder, folder as any));
  if (type)   extraConds.push(eq(correspondenceTable.type, type as any));
  if (scope)  extraConds.push(eq(correspondenceTable.scope, scope as string));

  if (wantsViewAll) {
    // Return all correspondence in scope:
    //   admin+  → automatic (org-level authority)
    //   PM/DC   → opt-in via viewAll=true query param
    const allItems = await db.select().from(correspondenceTable)
      .where(extraConds.length > 0 ? and(baseFilter, ...extraConds) : baseFilter)
      .orderBy(desc(correspondenceTable.updatedAt));
    const enriched = await enrichCorrespondence(allItems, userId);
    return { status: 200, body: {
      items: enriched,
      total: enriched.length,
      viewAll: true,
      viewAllReason: isAdminLevel ? "admin_authority" : "pm_dc_opt_in",
    } };
  }

  // Default mail-model: only show correspondence where caller is sender, To, or CC
  const sentWhere = extraConds.length > 0
    ? and(baseFilter, eq(correspondenceTable.fromUserId, userId), ...extraConds)
    : and(baseFilter, eq(correspondenceTable.fromUserId, userId));
  const sent = await db.select().from(correspondenceTable)
    .where(sentWhere)
    .orderBy(desc(correspondenceTable.updatedAt));

  const receivedRels = await db.select({ corrId: correspondenceRecipientsTable.correspondenceId })
    .from(correspondenceRecipientsTable)
    .where(eq(correspondenceRecipientsTable.userId, userId));

  const ccRels = await db.select({ corrId: correspondenceCcTable.correspondenceId })
    .from(correspondenceCcTable)
    .where(eq(correspondenceCcTable.userId, userId));

  const involvedIds = new Set([
    ...receivedRels.map(r => r.corrId),
    ...ccRels.map(r => r.corrId),
  ]);

  let received: (typeof correspondenceTable.$inferSelect)[] = [];
  if (involvedIds.size > 0) {
    // Query by IDs directly (not baseFilter) so cross-org received correspondence
    // is visible to named recipients regardless of organizationId.
    const receivedWhere = extraConds.length > 0
      ? and(inArray(correspondenceTable.id, [...involvedIds]), ...extraConds)
      : inArray(correspondenceTable.id, [...involvedIds]);
    received = await db.select().from(correspondenceTable)
      .where(receivedWhere)
      .orderBy(desc(correspondenceTable.updatedAt));
    received = received.filter(c => c.fromUserId !== userId);
  }

  let allItems = [...sent, ...received];
  const seen = new Set<number>();
  allItems = allItems.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });

  const enriched = await enrichCorrespondence(allItems, userId);
  return { status: 200, body: { items: enriched, total: enriched.length, viewAll: false } };
  });
  res.status(out.status).json(out.body);
});

router.post("/", requireAuth, parseBody(createCorrespondenceSchema), async (req: Request<ProjectParams>, res): Promise<void> => {
  const contextProjectId = req.params.projectId ? requireInt(req.params.projectId) : null;
  await createCorrespondence(req, res, contextProjectId);
});

router.get("/:id", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = req.params.projectId ? requireInt(req.params.projectId) : null;
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const userId = caller.id;

  // General endpoint (no projectId in the path): match by id across any scope so a
  // deep-link (?openCorr=<id>) can fetch a project-scoped item the caller is named on.
  // The access check below (sender / To / CC / view-all + cross-org guard) authorizes.
  const filter = projectId !== null
    ? and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId))
    : eq(correspondenceTable.id, id);

  // Class B read: this GET conditionally marks the item read (a WRITE), so it runs
  // in a short write unit-of-work. Access-check reads + mark-read + enrich share one tx.
  const out = await withTenant(async (): Promise<{ status: number; body: unknown }> => {
    const items = await db.select().from(correspondenceTable).where(filter).limit(1);
    if (!items[0]) return { status: 404, body: { error: "Not Found" } };

    // Access check: caller must be sender, To, CC, or same-org PM/DC with view-all capability.
    // Cross-org items require explicit naming in To or CC even for admin-level roles.
    const { role: effectiveRole } = await resolveEffectiveRole(caller, projectId ?? undefined);
    const isSender = items[0].fromUserId === userId;
    const isCrossOrgItem = items[0].organizationId !== null
      && items[0].organizationId !== caller.organizationId
      && !isSystemOwner(caller);
    if (!isSender && (!CorrespondencePermissions.hasViewAllCapability(effectiveRole) || isCrossOrgItem)) {
      const [toRow] = await db.select({ corrId: correspondenceRecipientsTable.correspondenceId })
        .from(correspondenceRecipientsTable)
        .where(and(eq(correspondenceRecipientsTable.correspondenceId, id), eq(correspondenceRecipientsTable.userId, userId)))
        .limit(1);
      const [ccRow] = await db.select({ corrId: correspondenceCcTable.correspondenceId })
        .from(correspondenceCcTable)
        .where(and(eq(correspondenceCcTable.correspondenceId, id), eq(correspondenceCcTable.userId, userId)))
        .limit(1);
      if (!toRow && !ccRow) return { status: 403, body: { error: "Forbidden", message: "You do not have access to this correspondence" } };
    }

    if (!items[0].isRead && items[0].fromUserId !== userId) {
      const now = new Date();
      await db.update(correspondenceTable)
        .set({
          isRead: true,
          firstReadAt: items[0].firstReadAt ?? now,
          updatedAt: now,
        })
        .where(eq(correspondenceTable.id, id));
      items[0].isRead = true;
      if (!items[0].firstReadAt) items[0].firstReadAt = now;
    }

    const enriched = await enrichCorrespondence(items, userId);
    return { status: 200, body: enriched[0] };
  });
  res.status(out.status).json(out.body);
});

// ─── Recall ───────────────────────────────────────────────────────────────────

router.post("/:id/recall", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;

  try {
    let result: { status: number; body: unknown } | undefined;
    let recalled: typeof correspondenceTable.$inferSelect | undefined;
    let recipients: { userId: number }[] = [];
    let existingOrgId: number | null | undefined;

    await withTenant(async () => {
      const [existing] = await db.select({
        id: correspondenceTable.id,
        fromUserId: correspondenceTable.fromUserId,
        status: correspondenceTable.status,
        isRead: correspondenceTable.isRead,
        subject: correspondenceTable.subject,
        referenceNumber: correspondenceTable.referenceNumber,
        projectId: correspondenceTable.projectId,
        organizationId: correspondenceTable.organizationId,
      }).from(correspondenceTable)
        .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId)).limit(1);

      if (!existing) { result = { status: 404, body: { error: "Not Found" } }; return; }
      existingOrgId = existing.organizationId;

      const { role: effectiveRole } = await resolveEffectiveRole(caller, existing.projectId ?? undefined);
      const isSender = existing.fromUserId === caller.id;
      if (!isSender && !CorrespondencePermissions.canClose(effectiveRole)) {
        result = { status: 403, body: { error: "Forbidden", message: "Only the sender or a document controller can recall correspondence" } }; return;
      }
      if (existing.status === "draft") {
        result = { status: 400, body: { error: "Bad Request", message: "Draft correspondence has not been sent and cannot be recalled" } }; return;
      }
      if (existing.status === "recalled") {
        result = { status: 409, body: { error: "Conflict", message: "This correspondence has already been recalled" } }; return;
      }
      if (existing.isRead) {
        result = { status: 409, body: { error: "Conflict", code: "ALREADY_OPENED", message: "Recall is not possible — at least one recipient has already opened this correspondence. The item remains on record for audit purposes." } }; return;
      }

      const now = new Date();
      [recalled] = await db.update(correspondenceTable)
        .set({ status: "recalled", recalledAt: now, recalledById: caller.id, updatedAt: now })
        .where(eq(correspondenceTable.id, id))
        .returning();

      await createAuditLog({
        userId: caller.id,
        organizationId: existing.organizationId ?? undefined,
        action: "recall",
        entityType: "correspondence",
        entityId: id,
        entityTitle: existing.referenceNumber ?? existing.subject,
        projectId: existing.projectId ?? undefined,
        details: { recalledBy: caller.id, recalledAt: now.toISOString() },
      });

      // Cancel the linked task (Task To) when correspondence is recalled
      const [linkedTask] = await db.select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.sourceType, "correspondence"), eq(tasksTable.sourceId, id)))
        .limit(1);
      if (linkedTask) {
        await db.update(tasksTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(tasksTable.id, linkedTask.id));
      }

      recipients = await db.select({ userId: correspondenceRecipientsTable.userId })
        .from(correspondenceRecipientsTable)
        .where(eq(correspondenceRecipientsTable.correspondenceId, id));
      result = { status: 200, body: null };
    });

    if (result!.status !== 200) { res.status(result!.status).json(result!.body); return; }

    // Notify all To recipients that the item was recalled — post-commit (notification subsystem).
    for (const r of recipients) {
      if (r.userId === caller.id) continue;
      await dispatchNotification({
        event: "correspondence_recalled" as any,
        recipients: r.userId ? [{ userId: r.userId, email: "" }] : [],
        sendEmail: async () => {},
        organizationId: existingOrgId ?? undefined,
        entityType: "correspondence",
        entityId: id,
      }).catch(() => {});
    }

    const enriched = await withTenant(() => enrichCorrespondence([recalled!], caller.id));
    res.json(enriched[0]);
  } catch (e) { next(e); }
});

router.put("/:id/read", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const { isRead } = req.body ?? {}; // tolerate a missing/empty body (was: TypeError → 500)
  try {
    const corr = await withTenant(async () => {
      const [c] = await db.update(correspondenceTable)
        .set({ isRead: !!isRead, updatedAt: new Date() })
        .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId))
        .returning();
      return c;
    });
    if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
    res.json({ id: corr.id, isRead: corr.isRead });
  } catch (e) { next(e); }
});

router.put("/:id", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const { subject, body, folder, status, referenceNumber, taskToId } = req.body;
  const orgId = caller.organizationId;
  const newAssignedToId = taskToId ? parseInt(taskToId) : undefined;

  try {
    let result: { status: number; body: unknown } | undefined;
    let corr: typeof correspondenceTable.$inferSelect | undefined;
    let prevAssignedToId: number | null | undefined;

    await withTenant(async () => {
      const [existing] = await db.select({
        fromUserId: correspondenceTable.fromUserId,
        projectId: correspondenceTable.projectId,
        status: correspondenceTable.status,
        assignedToId: correspondenceTable.assignedToId,
      }).from(correspondenceTable)
        .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId)).limit(1);
      if (!existing) { result = { status: 404, body: { error: "Not Found" } }; return; }
      prevAssignedToId = existing.assignedToId;

      const { role: effectiveRole } = await resolveEffectiveRole(caller, existing.projectId ?? undefined);
      const isCreator = existing.fromUserId === caller.id;

      const isStatusOrFolderChange = (status !== undefined && status !== existing.status) || folder !== undefined;
      if (isStatusOrFolderChange && !CorrespondencePermissions.canClose(effectiveRole)) {
        result = { status: 403, body: { error: "Forbidden", message: "Only document controllers and above can close or archive correspondence" } }; return;
      }
      const isContentChange = subject !== undefined || body !== undefined;
      if (isContentChange && !isCreator && !CorrespondencePermissions.canClose(effectiveRole)) {
        result = { status: 403, body: { error: "Forbidden", message: "Only the sender or a document controller can edit correspondence content" } }; return;
      }

      if (referenceNumber?.trim()) {
        const trimmed = referenceNumber.trim();
        const duplicate = await db.select({ id: correspondenceTable.id })
          .from(correspondenceTable)
          .where(and(
            eq(correspondenceTable.organizationId, orgId!),
            eq(correspondenceTable.referenceNumber, trimmed),
            sql`${correspondenceTable.id} != ${id}`,
          ))
          .limit(1);
        if (duplicate.length > 0) { result = { status: 409, body: { error: `Reference number "${trimmed}" already exists in this organization.` } }; return; }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (subject !== undefined) updateData.subject = subject;
      if (body !== undefined) updateData.body = body;
      if (folder !== undefined) updateData.folder = folder;
      if (status !== undefined) updateData.status = status;
      if (referenceNumber !== undefined) updateData.referenceNumber = referenceNumber?.trim() || undefined;
      if (newAssignedToId !== undefined) updateData.assignedToId = newAssignedToId;

      const [c] = await db.update(correspondenceTable)
        .set(updateData)
        .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId))
        .returning();
      if (!c) { result = { status: 404, body: { error: "Not Found" } }; return; }
      corr = c;
      result = { status: 200, body: null };
    });

    if (result!.status !== 200) { res.status(result!.status).json(result!.body); return; }

    // Sync linked task on status/assignedToId changes — best-effort, own short tx.
    try {
      await withTenant(async () => {
        const [linkedTask] = await db.select({ id: tasksTable.id, status: tasksTable.status })
          .from(tasksTable)
          .where(and(eq(tasksTable.sourceType, "correspondence"), eq(tasksTable.sourceId, id)))
          .limit(1);
        if (linkedTask) {
          const taskUpdate: Record<string, unknown> = { updatedAt: new Date() };
          if (status === "closed" && linkedTask.status !== "completed") {
            taskUpdate.status = "completed";
            taskUpdate.completedAt = new Date();
          }
          if (newAssignedToId !== undefined && newAssignedToId !== prevAssignedToId) {
            taskUpdate.assignedToId = newAssignedToId;
            taskUpdate.assignedAt = new Date();
          }
          if (Object.keys(taskUpdate).length > 1) {
            await db.update(tasksTable).set(taskUpdate).where(eq(tasksTable.id, linkedTask.id));
          }
        }
      });
    } catch (_) {}

    const enriched = await withTenant(() => enrichCorrespondence([corr!], caller.id));
    res.json(enriched[0]);
  } catch (e) { next(e); }
});

router.post("/:id/reply", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const contextProjectId = req.params.projectId ? requireInt(req.params.projectId) : null;
  const parentId = requireInt(req.params.id);
  const caller = req.user!;
  const { subject, type, body, toUserIds, ccUserIds } = req.body;

  try {
    let result: { status: number; body: unknown } | undefined;
    let corr: typeof correspondenceTable.$inferSelect | undefined;

    await withTenant(async () => {
      // Only member+ can reply
      const { role: effectiveRole } = await resolveEffectiveRole(caller, contextProjectId ?? undefined);
      if (!CorrespondencePermissions.canReply(effectiveRole)) {
        result = { status: 403, body: { error: "Forbidden", message: "You do not have permission to reply to correspondence" } }; return;
      }

      const parent = await db.select({
          projectId: correspondenceTable.projectId,
          scope: correspondenceTable.scope,
          organizationId: correspondenceTable.organizationId,
        })
        .from(correspondenceTable)
        .where(eq(correspondenceTable.id, parentId))
        .limit(1);
      if (!parent[0]) { result = { status: 404, body: { error: "Not Found" } }; return; }

      // Tenant isolation: cross-org callers must be an explicit recipient of the parent.
      if (!isSystemOwner(caller) && parent[0].organizationId !== caller.organizationId) {
        const [recipientRow] = await db
          .select({ userId: correspondenceRecipientsTable.userId })
          .from(correspondenceRecipientsTable)
          .where(and(
            eq(correspondenceRecipientsTable.correspondenceId, parentId),
            eq(correspondenceRecipientsTable.userId, caller.id!),
          ))
          .limit(1);
        if (!recipientRow) { result = { status: 403, body: { error: "Forbidden", message: "You are not a recipient of this correspondence." } }; return; }
      }

      const orgId: number | null = caller.organizationId ?? parent[0]?.organizationId ?? null;
      if (!orgId) {
        result = { status: 400, body: {
          error: "No organization context",
          message: isSystemOwner(caller)
            ? "This correspondence is not linked to any organization, so a reply cannot be sent. Please contact a system administrator to correct the correspondence data."
            : "Your account is not assigned to an organization. Please contact your administrator to resolve this before sending correspondence.",
        } }; return;
      }

      const effectiveProjectId = contextProjectId ?? parent[0]?.projectId ?? null;
      const scope = parent[0]?.scope ?? "project";

      await db.update(correspondenceTable)
        .set({ status: "responded", updatedAt: new Date() })
        .where(eq(correspondenceTable.id, parentId));

      // Complete the linked task when parent correspondence is responded (in-tx; part of reply)
      const [linkedTask] = await db.select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.sourceType, "correspondence"), eq(tasksTable.sourceId, parentId)))
        .limit(1);
      if (linkedTask) {
        await db.update(tasksTable)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(tasksTable.id, linkedTask.id));
      }

      const { refNum } = await resolveReferenceNumber({
        orgId, scope, projectId: scope === "project" ? effectiveProjectId : null, manualRef: null,
      });

      const [c] = await db.insert(correspondenceTable).values({
        subject: subject || `Re: ...`,
        type: type || "letter",
        body: body || "",
        organizationId: orgId,
        fromUserId: req.user!.id,
        projectId: effectiveProjectId,
        scope,
        parentId,
        folder: "sent",
        status: "sent",
        referenceNumber: refNum,
        sentAt: new Date(),
      }).returning();
      corr = c;

      if (toUserIds?.length > 0) {
        await db.insert(correspondenceRecipientsTable).values(
          toUserIds.map((uid: number) => ({ correspondenceId: c.id, userId: uid }))
        );
      }
      if (ccUserIds?.length > 0) {
        await db.insert(correspondenceCcTable).values(
          (ccUserIds as number[]).map((uid: number) => ({ correspondenceId: c.id, userId: uid }))
        );
      }
      result = { status: 201, body: null };
    });

    if (result!.status !== 201) { res.status(result!.status).json(result!.body); return; }
    const enriched = await withTenant(() => enrichCorrespondence([corr!], req.user!.id));
    res.status(201).json(enriched[0]);
  } catch (e) { next(e); }
});

// ─── Attachments ──────────────────────────────────────────────────────────────

router.post("/:id/attachments", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const corrId = requireInt(req.params.id);
  const caller = req.user!;
  const { fileName, fileUrl, fileSize } = req.body;
  try {
    let result: { status: number; body: unknown } | undefined;
    await withTenant(async () => {
      const [corr] = await db.select({ id: correspondenceTable.id }).from(correspondenceTable)
        .where(orgScopedWhere(caller, correspondenceTable.id, corrId, correspondenceTable.organizationId)).limit(1);
      if (!corr) { result = { status: 404, body: { error: "Correspondence not found" } }; return; }
      const [att] = await db.insert(correspondenceAttachmentsTable).values({
        correspondenceId: corrId, fileName, fileUrl, fileSize,
      }).returning();
      result = { status: 201, body: att };
    });
    res.status(result!.status).json(result!.body);
  } catch (e) { next(e); }
});

router.delete("/:id/attachments/:attId", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const attId = requireInt(req.params.attId);
  const caller = req.user!;
  try {
    let result: { status: number; body: unknown } | undefined;
    await withTenant(async () => {
      // correspondence_attachments has no RLS — app-level check is the only guard.
      const [att] = await db
        .select({ orgId: correspondenceTable.organizationId })
        .from(correspondenceAttachmentsTable)
        .innerJoin(correspondenceTable, eq(correspondenceAttachmentsTable.correspondenceId, correspondenceTable.id))
        .where(and(
          eq(correspondenceAttachmentsTable.id, attId),
          eq(correspondenceAttachmentsTable.correspondenceId, id),
        ))
        .limit(1);
      if (!att) { result = { status: 404, body: { error: "Not Found" } }; return; }
      if (!isSystemOwner(caller) && att.orgId !== caller.organizationId) {
        result = { status: 403, body: { error: "Forbidden", message: "Cross-organization access denied." } }; return;
      }
      await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.id, attId));
      result = { status: 200, body: { success: true } };
    });
    res.status(result!.status).json(result!.body);
  } catch (e) { next(e); }
});

router.delete("/:id", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  try {
    let result: { status: number; body: unknown } | undefined;
    await withTenant(async () => {
      const [existing] = await db.select({
        projectId: correspondenceTable.projectId,
        subject: correspondenceTable.subject,
        referenceNumber: correspondenceTable.referenceNumber,
      }).from(correspondenceTable)
        .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId)).limit(1);
      if (!existing) { result = { status: 404, body: { error: "Not found" } }; return; }

      const { role: effectiveRole } = await resolveEffectiveRole(caller, existing.projectId ?? undefined);
      if (!CorrespondencePermissions.canDelete(effectiveRole)) {
        result = { status: 403, body: { error: "Forbidden", message: "Only administrators can delete correspondence threads" } }; return;
      }

      await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, id));
      await db.delete(correspondenceRecipientsTable).where(eq(correspondenceRecipientsTable.correspondenceId, id));
      await db.delete(correspondenceCcTable).where(eq(correspondenceCcTable.correspondenceId, id));
      const [deleted] = await db.delete(correspondenceTable).where(eq(correspondenceTable.id, id)).returning();
      if (!deleted) { result = { status: 404, body: { error: "Not found" } }; return; }

      await createAuditLog({
        userId: caller.id,
        organizationId: caller.organizationId,
        action: "delete",
        entityType: "correspondence",
        entityId: id,
        entityTitle: existing.referenceNumber ?? existing.subject,
        projectId: existing.projectId ?? undefined,
        details: { deletedBy: caller.id },
      });
      result = { status: 200, body: { success: true } };
    });
    res.status(result!.status).json(result!.body);
  } catch (e) { next(e); }
});

// ─── Share link ───────────────────────────────────────────────────────────────

router.post("/:id/share", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const projectId = requireInt(req.params.projectId);
  const { expiresInDays, password } = req.body;

  // Token material + bcrypt OUTSIDE the tenant transaction (CPU-bound).
  const token = crypto.randomBytes(32).toString("hex");
  const days = Math.min(Math.max(parseInt(expiresInDays) || 30, 1), 90);
  const expiresAt = new Date(Date.now() + days * 86400000);
  const passwordHash = password ? await hashPassword(password) : null;

  try {
    let result: { status: number; body: unknown } | undefined;
    await withTenant(async () => {
      // Verify the project belongs to the caller's org — prevents cross-tenant share.
      const [project] = await db.select({ id: projectsTable.id })
        .from(projectsTable)
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, req.user!.organizationId!)))
        .limit(1);
      if (!project) { result = { status: 404, body: { error: "Not found" } }; return; }

      const [corr] = await db.update(correspondenceTable)
        .set({
          shareToken: hashToken(token),
          shareExpiresAt: expiresAt,
          sharePasswordHash: passwordHash ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
        .returning({ id: correspondenceTable.id, shareExpiresAt: correspondenceTable.shareExpiresAt });
      if (!corr) { result = { status: 404, body: { error: "Not found" } }; return; }

      await createAuditLog({
        userId: req.user!.id, action: "share", entityType: "correspondence",
        entityId: id, details: { expiresInDays: days, passwordProtected: !!password },
      });
      const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
      result = { status: 200, body: { shareUrl: `${baseUrl}/shared/correspondence/${token}`, shareToken: token, expiresAt } };
    });
    res.status(result!.status).json(result!.body);
  } catch (e) { next(e); }
});

router.delete("/:id/share", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  try {
    const rows = await withTenant(() => db.update(correspondenceTable)
      .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
      .where(orgScopedWhere(caller, correspondenceTable.id, id, correspondenceTable.organizationId))
      .returning({ id: correspondenceTable.id }));
    if (rows.length === 0) { res.status(404).json({ error: "Not Found" }); return; }
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
