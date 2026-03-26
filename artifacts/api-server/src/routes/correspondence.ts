import { Router } from "express";
import { db } from "@workspace/db";
import { correspondenceTable, correspondenceRecipientsTable, correspondenceAttachmentsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

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
  const { subject, type, body, toUserIds, sendNow } = req.body;

  const refNum = `${type.toUpperCase().slice(0, 3)}-${projectId}-${Date.now().toString().slice(-6)}`;

  const [corr] = await db.insert(correspondenceTable).values({
    subject, type,
    body: body || "",
    fromUserId: req.user!.id,
    projectId,
    folder: sendNow ? "sent" : "draft",
    status: sendNow ? "sent" : "draft",
    referenceNumber: refNum,
    sentAt: sendNow ? new Date() : undefined,
  }).returning();

  if (toUserIds?.length > 0) {
    await db.insert(correspondenceRecipientsTable).values(
      toUserIds.map((uid: number) => ({ correspondenceId: corr.id, userId: uid }))
    );
    // Create inbox items for recipients
    if (sendNow) {
      // Recipients see it in their inbox automatically via query
    }
  }

  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "correspondence", entityId: corr.id, entityTitle: corr.subject, projectId });
  const enriched = await enrichCorrespondence([corr]);
  res.status(201).json(enriched[0]);
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const id = parseInt(req.params.id);
  const items = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.id, id), eq(correspondenceTable.projectId, projectId)))
    .limit(1);
  if (!items[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const enriched = await enrichCorrespondence(items);
  res.json(enriched[0]);
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

export default router;
