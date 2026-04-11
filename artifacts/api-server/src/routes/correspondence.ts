import { Router } from "express";
import { db } from "@workspace/db";
import {
  correspondenceTable,
  correspondenceRecipientsTable,
  correspondenceAttachmentsTable,
  correspondenceSequencesTable,
  usersTable,
  projectsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, or, desc, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { evaluateRules } from "../lib/rule-engine.js";
import { classifyItem } from "../lib/ai-service.js";
import { sendCorrespondenceReceivedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";

const router = Router({ mergeParams: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enrichCorrespondence(items: (typeof correspondenceTable.$inferSelect)[]) {
  if (items.length === 0) return [];

  const itemIds = items.map(i => i.id);

  const recipients = await db.select({
    corrId: correspondenceRecipientsTable.correspondenceId,
    userId: correspondenceRecipientsTable.userId,
    user: usersTable,
  }).from(correspondenceRecipientsTable)
    .leftJoin(usersTable, eq(correspondenceRecipientsTable.userId, usersTable.id))
    .where(inArray(correspondenceRecipientsTable.correspondenceId, itemIds));

  const attachments = await db.select().from(correspondenceAttachmentsTable)
    .where(inArray(correspondenceAttachmentsTable.correspondenceId, itemIds));

  const fromUserIds = [...new Set(items.map(i => i.fromUserId))];
  const fromUsers = fromUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, fromUserIds))
    : [];
  const fromUserMap = new Map(fromUsers.map(u => [u.id, u]));

  const recipientMap = new Map<number, { ids: number[]; names: string[] }>();
  for (const r of recipients) {
    if (!recipientMap.has(r.corrId)) recipientMap.set(r.corrId, { ids: [], names: [] });
    const entry = recipientMap.get(r.corrId)!;
    entry.ids.push(r.userId);
    if (r.user) entry.names.push(`${r.user.firstName} ${r.user.lastName}`);
  }

  const attachmentMap = new Map<number, typeof attachments>();
  for (const a of attachments) {
    if (!attachmentMap.has(a.correspondenceId)) attachmentMap.set(a.correspondenceId, []);
    attachmentMap.get(a.correspondenceId)!.push(a);
  }

  return items.map(item => {
    const fromUser = fromUserMap.get(item.fromUserId);
    const recs = recipientMap.get(item.id) || { ids: [], names: [] };
    const atts = attachmentMap.get(item.id) || [];
    return {
      ...item,
      fromUserName: fromUser ? `${fromUser.firstName} ${fromUser.lastName}` : undefined,
      toUserIds: recs.ids,
      toUserNames: recs.names,
      attachments: atts.map(a => ({ id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize, uploadedAt: a.uploadedAt })),
    };
  });
}

/**
 * Generate or validate a correspondence reference number.
 *
 * Rules:
 *  - If caller provides manualRef → validate uniqueness within the org, return it.
 *  - Otherwise auto-generate:
 *      internal scope → INT-{YYYY}-{SEQ:04d}
 *      project scope  → {ProjectCode}-{YYYY}-{SEQ:04d}
 *  - Sequence is per (org + scope + projectId + year) and incremented atomically.
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
  const {
    subject,
    type,
    body,
    toUserIds,
    sendNow,
    priority,
    dueDate,
    cc,
    taskToId,
    attachments,
    referenceNumber: manualRef,
    scope: rawScope,
    projectId: bodyProjectId,
  } = req.body;

  const orgId = req.user!.organizationId;
  if (!orgId) { res.status(400).json({ error: "User has no organization" }); return; }
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

  const { refNum, error: refError } = await resolveReferenceNumber({
    orgId,
    scope,
    projectId: scope === "project" ? effectiveProjectId : null,
    manualRef,
  });
  if (refError) { res.status(409).json({ error: refError }); return; }

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
    cc: cc || null,
    assignedToId: taskToId ? parseInt(taskToId) : undefined,
  }).returning();

  if (toUserIds?.length > 0) {
    await db.insert(correspondenceRecipientsTable).values(
      toUserIds.map((uid: number) => ({ correspondenceId: corr.id, userId: uid }))
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

  try { await classifyItem({ type: "correspondence", organizationId: orgId, subject: corr.subject, body: corr.body }); } catch (_) {}

  try {
    await evaluateRules({
      type: "correspondence",
      orgId,
      projectId: effectiveProjectId ?? undefined,
      subject: corr.subject,
      senderUserId: req.user!.id,
      entityId: corr.id,
      entityTitle: corr.subject,
      triggeredByUserId: req.user!.id,
    });
  } catch (_) {}

  if (sendNow && toUserIds?.length > 0) {
    const [sender] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));
    const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "Someone";

    try {
      await db.insert(notificationsTable).values(
        (toUserIds as number[]).map((uid: number) => ({
          userId: uid,
          type: "correspondence_received" as const,
          title: `New correspondence: ${corr.subject}`,
          message: `${senderName} sent you a ${corr.type} — ${corr.subject}`,
          projectId: effectiveProjectId,
          entityType: "correspondence",
          entityId: corr.id,
          actionUrl: `/correspondence`,
        }))
      );
    } catch (_) {}

    try {
      const recipientUsers = await db
        .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(inArray(usersTable.id, toUserIds as number[]));

      const project = effectiveProjectId
        ? (await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, effectiveProjectId)).limit(1))[0]
        : null;

      await dispatchNotification({
        event: "correspondence_received",
        recipients: recipientUsers.map(r => ({ userId: r.id, email: r.email, name: `${r.firstName} ${r.lastName}`.trim() })),
        sendEmail: (to) => sendCorrespondenceReceivedEmail({
          to,
          subject: corr.subject,
          correspondenceType: corr.type,
          senderName,
          priority: corr.priority ?? undefined,
          projectName: project?.name,
          referenceNumber: corr.referenceNumber ?? undefined,
          projectId: effectiveProjectId ?? 0,
        }),
      });
    } catch (_) {}
  }

  const enriched = await enrichCorrespondence([corr]);
  res.status(201).json(enriched[0]);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const projectId = req.params.projectId ? parseInt(req.params.projectId) : null;
  const { folder, type, scope } = req.query;
  const userId = req.user!.id;
  const orgId = req.user!.organizationId;

  const baseFilter = projectId !== null
    // Project-specific view: all items (any scope) whose projectId matches
    ? and(
        eq(correspondenceTable.organizationId, orgId!),
        eq(correspondenceTable.projectId, projectId)
      )
    // Global view: items with no projectId, PLUS internal items that carry a project reference
    : and(
        eq(correspondenceTable.organizationId, orgId!),
        or(
          isNull(correspondenceTable.projectId),
          eq(correspondenceTable.scope, "internal")
        )
      );

  const sent = await db.select().from(correspondenceTable)
    .where(and(baseFilter, eq(correspondenceTable.fromUserId, userId)))
    .orderBy(desc(correspondenceTable.updatedAt));

  const receivedRels = await db.select({ corrId: correspondenceRecipientsTable.correspondenceId })
    .from(correspondenceRecipientsTable)
    .where(eq(correspondenceRecipientsTable.userId, userId));

  const receivedIds = receivedRels.map(r => r.corrId);
  let received: (typeof correspondenceTable.$inferSelect)[] = [];
  if (receivedIds.length > 0) {
    received = await db.select().from(correspondenceTable)
      .where(baseFilter)
      .orderBy(desc(correspondenceTable.updatedAt));
    received = received.filter(c => receivedIds.includes(c.id) && c.fromUserId !== userId);
  }

  let allItems = [...sent, ...received];
  const seen = new Set<number>();
  allItems = allItems.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });

  if (folder) allItems = allItems.filter(i => i.folder === folder);
  if (type) allItems = allItems.filter(i => i.type === type);
  if (scope) allItems = allItems.filter(i => i.scope === scope);

  const enriched = await enrichCorrespondence(allItems);
  res.json({ items: enriched, total: enriched.length });
});

router.post("/", requireAuth, async (req, res) => {
  const contextProjectId = req.params.projectId ? parseInt(req.params.projectId) : null;
  await createCorrespondence(req, res, contextProjectId);
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = req.params.projectId ? parseInt(req.params.projectId) : null;
  const id = parseInt(req.params.id);
  const userId = req.user!.id;

  const filter = projectId !== null
    ? and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId))
    : and(eq(correspondenceTable.id, id), isNull(correspondenceTable.projectId));

  const items = await db.select().from(correspondenceTable).where(filter).limit(1);
  if (!items[0]) { res.status(404).json({ error: "Not Found" }); return; }

  if (!items[0].isRead && items[0].fromUserId !== userId) {
    await db.update(correspondenceTable)
      .set({ isRead: true, updatedAt: new Date() })
      .where(eq(correspondenceTable.id, id));
    items[0].isRead = true;
  }

  const enriched = await enrichCorrespondence(items);
  res.json(enriched[0]);
});

router.put("/:id/read", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { isRead } = req.body;
  const [corr] = await db.update(correspondenceTable)
    .set({ isRead: !!isRead, updatedAt: new Date() })
    .where(eq(correspondenceTable.id, id))
    .returning();
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ id: corr.id, isRead: corr.isRead });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { subject, body, folder, status, referenceNumber } = req.body;
  const orgId = req.user!.organizationId;

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
    if (duplicate.length > 0) {
      res.status(409).json({ error: `Reference number "${trimmed}" already exists in this organization.` });
      return;
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (subject !== undefined) updateData.subject = subject;
  if (body !== undefined) updateData.body = body;
  if (folder !== undefined) updateData.folder = folder;
  if (status !== undefined) updateData.status = status;
  if (referenceNumber !== undefined) updateData.referenceNumber = referenceNumber?.trim() || undefined;

  const [corr] = await db.update(correspondenceTable)
    .set(updateData)
    .where(eq(correspondenceTable.id, id))
    .returning();
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichCorrespondence([corr]);
  res.json(enriched[0]);
});

router.post("/:id/reply", requireAuth, async (req, res) => {
  const contextProjectId = req.params.projectId ? parseInt(req.params.projectId) : null;
  const parentId = parseInt(req.params.id);
  const orgId = req.user!.organizationId;
  if (!orgId) { res.status(400).json({ error: "User has no organization" }); return; }

  const { subject, type, body, toUserIds } = req.body;

  const parent = await db.select({ projectId: correspondenceTable.projectId, scope: correspondenceTable.scope })
    .from(correspondenceTable)
    .where(eq(correspondenceTable.id, parentId))
    .limit(1);

  const effectiveProjectId = contextProjectId ?? parent[0]?.projectId ?? null;
  const scope = parent[0]?.scope ?? "project";

  await db.update(correspondenceTable)
    .set({ status: "responded", updatedAt: new Date() })
    .where(eq(correspondenceTable.id, parentId));

  const { refNum } = await resolveReferenceNumber({
    orgId,
    scope,
    projectId: scope === "project" ? effectiveProjectId : null,
    manualRef: null,
  });

  const [corr] = await db.insert(correspondenceTable).values({
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

  if (toUserIds?.length > 0) {
    await db.insert(correspondenceRecipientsTable).values(
      toUserIds.map((uid: number) => ({ correspondenceId: corr.id, userId: uid }))
    );
  }

  const enriched = await enrichCorrespondence([corr]);
  res.status(201).json(enriched[0]);
});

// ─── Attachments ──────────────────────────────────────────────────────────────

router.post("/:id/attachments", requireAuth, async (req, res) => {
  const corrId = parseInt(req.params.id);
  const { fileName, fileUrl, fileSize } = req.body;
  const [att] = await db.insert(correspondenceAttachmentsTable).values({
    correspondenceId: corrId,
    fileName,
    fileUrl,
    fileSize,
  }).returning();
  res.status(201).json(att);
});

router.delete("/:id/attachments/:attId", requireAuth, async (req, res) => {
  const attId = parseInt(req.params.attId);
  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.id, attId));
  res.json({ success: true });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, id));
  await db.delete(correspondenceRecipientsTable).where(eq(correspondenceRecipientsTable.correspondenceId, id));
  const [deleted] = await db.delete(correspondenceTable)
    .where(eq(correspondenceTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

// ─── Share link ───────────────────────────────────────────────────────────────

router.post("/:id/share", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { expiresInDays, password } = req.body;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;
  const passwordHash = password ? await hashPassword(password) : null;

  const [corr] = await db.update(correspondenceTable)
    .set({
      shareToken: token,
      shareExpiresAt: expiresAt ?? undefined,
      sharePasswordHash: passwordHash ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(correspondenceTable.id, id))
    .returning({ id: correspondenceTable.id, shareToken: correspondenceTable.shareToken, shareExpiresAt: correspondenceTable.shareExpiresAt });

  if (!corr) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog({
    userId: req.user!.id, action: "share", entityType: "correspondence",
    entityId: id, details: { token, expiresInDays, passwordProtected: !!password },
  });

  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({
    shareUrl: `${baseUrl}/shared/correspondence/${token}`,
    shareToken: token,
    expiresAt,
  });
});

router.delete("/:id/share", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.update(correspondenceTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(eq(correspondenceTable.id, id));
  res.json({ success: true });
});

export default router;
