import { Router } from "express";
import { db } from "@workspace/db";
import { correspondenceTable, correspondenceRecipientsTable, correspondenceAttachmentsTable, usersTable, projectsTable, notificationsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import crypto from "crypto";
import { evaluateRules } from "../lib/rule-engine.js";
import { classifyItem } from "../lib/ai-service.js";
import { sendCorrespondenceReceivedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";

const router = Router({ mergeParams: true });

async function enrichCorrespondence(items: (typeof correspondenceTable.$inferSelect)[]) {
  if (items.length === 0) return [];
  const correspondenceIds = items.map(i => i.id);

  const recipients = await db.select({
    corrId: correspondenceRecipientsTable.correspondenceId,
    userId: correspondenceRecipientsTable.userId,
    user: usersTable,
  }).from(correspondenceRecipientsTable)
    .leftJoin(usersTable, eq(correspondenceRecipientsTable.userId, usersTable.id));

  const attachments = await db.select().from(correspondenceAttachmentsTable);

  const fromUserIds = [...new Set(items.map(i => i.fromUserId))];
  const fromUsers = await db.select().from(usersTable).where(eq(usersTable.id, fromUserIds[0]));
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

router.get("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { folder, type } = req.query;
  const userId = req.user!.id;

  // Get sent by user
  const sent = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.projectId, projectId), eq(correspondenceTable.fromUserId, userId)))
    .orderBy(desc(correspondenceTable.updatedAt));

  // Get received by user
  const receivedRels = await db.select({ corrId: correspondenceRecipientsTable.correspondenceId })
    .from(correspondenceRecipientsTable)
    .where(eq(correspondenceRecipientsTable.userId, userId));

  const receivedIds = receivedRels.map(r => r.corrId);
  let received: (typeof correspondenceTable.$inferSelect)[] = [];
  if (receivedIds.length > 0) {
    received = await db.select().from(correspondenceTable)
      .where(eq(correspondenceTable.projectId, projectId))
      .orderBy(desc(correspondenceTable.updatedAt));
    received = received.filter(c => receivedIds.includes(c.id) && c.fromUserId !== userId);
  }

  let allItems = [...sent, ...received];
  // Deduplicate
  const seen = new Set<number>();
  allItems = allItems.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });

  if (folder) allItems = allItems.filter(i => i.folder === folder);
  if (type) allItems = allItems.filter(i => i.type === type);

  const enriched = await enrichCorrespondence(allItems);
  res.json({ items: enriched, total: enriched.length });
});

router.post("/", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { subject, type, body, toUserIds, sendNow, priority, dueDate, cc, taskToId, attachments } = req.body;

  const refNum = `${type.toUpperCase().slice(0, 3)}-${projectId}-${Date.now().toString().slice(-6)}`;

  const [corr] = await db.insert(correspondenceTable).values({
    subject, type,
    body: body || "",
    organizationId: req.user!.organizationId ?? null,
    fromUserId: req.user!.id,
    projectId,
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

  // Save attachments
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

  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "correspondence", entityId: corr.id, entityTitle: corr.subject, projectId });

  // AI classification (non-blocking)
  try { await classifyItem({ type: "correspondence", organizationId: req.user!.organizationId, subject: corr.subject, body: corr.body }); } catch (_) {}

  // Rules engine (non-blocking)
  try {
    const orgId = req.user!.organizationId;
    if (orgId) {
      await evaluateRules({
        type: "correspondence",
        orgId,
        projectId,
        subject: corr.subject,
        senderUserId: req.user!.id,
        entityId: corr.id,
        entityTitle: corr.subject,
        triggeredByUserId: req.user!.id,
      });
    }
  } catch (_) {}

  // Notify recipients when correspondence is sent (not a draft)
  if (sendNow && toUserIds?.length > 0) {
    const [sender] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable).where(eq(usersTable.id, req.user!.id));
    const senderName = sender ? `${sender.firstName} ${sender.lastName}`.trim() : "Someone";
    try {
      await db.insert(notificationsTable).values(
        (toUserIds as number[]).map((uid: number) => ({
          userId: uid,
          type: "correspondence_received" as const,
          title: `New correspondence: ${corr.subject}`,
          message: `${senderName} sent you a ${corr.type} — ${corr.subject}`,
          projectId,
          entityType: "correspondence",
          entityId: corr.id,
          actionUrl: `/correspondence`,
        }))
      );
    } catch (_) {}
    try {
      const recipientUsers = await db
        .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(inArray(usersTable.id, toUserIds as number[]));
      const [project] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
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
          projectId,
        }),
      });
    } catch (_) {}
  }

  const enriched = await enrichCorrespondence([corr]);
  res.status(201).json(enriched[0]);
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const userId = req.user!.id;
  const items = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
    .limit(1);
  if (!items[0]) { res.status(404).json({ error: "Not Found" }); return; }

  // Auto-mark as read if the current user is a recipient (not the sender)
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
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { isRead } = req.body;
  const [corr] = await db.update(correspondenceTable)
    .set({ isRead: !!isRead, updatedAt: new Date() })
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
    .returning();
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ id: corr.id, isRead: corr.isRead });
});

router.put("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const { subject, body, folder, status } = req.body;
  const [corr] = await db.update(correspondenceTable)
    .set({ subject, body, folder, status, updatedAt: new Date() })
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
    .returning();
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichCorrespondence([corr]);
  res.json(enriched[0]);
});

router.post("/:id/reply", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const parentId = parseInt(req.params.id);
  const { subject, type, body, toUserIds } = req.body;

  // Mark parent as responded
  await db.update(correspondenceTable)
    .set({ status: "responded", updatedAt: new Date() })
    .where(eq(correspondenceTable.id, parentId));

  const refNum = `${(type || "REPLY").toUpperCase().slice(0, 3)}-${projectId}-${Date.now().toString().slice(-6)}`;

  const [corr] = await db.insert(correspondenceTable).values({
    subject: subject || `Re: ...`,
    type: type || "letter",
    body: body || "",
    organizationId: req.user!.organizationId ?? null,
    fromUserId: req.user!.id,
    projectId,
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
  const projectId = parseInt(req.params.projectId);
  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, id));
  await db.delete(correspondenceRecipientsTable).where(eq(correspondenceRecipientsTable.correspondenceId, id));
  const [deleted] = await db.delete(correspondenceTable)
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

// ─── Share link ───────────────────────────────────────────────────────────────
router.post("/:id/share", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
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
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  await db.update(correspondenceTable)
    .set({ shareToken: null, shareExpiresAt: null, sharePasswordHash: null, updatedAt: new Date() })
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)));
  res.json({ success: true });
});

export default router;
