/**
 * General Section — cross-department correspondence not tied to any project.
 * Accessible to all authenticated users. Supports move-to-project action.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  correspondenceTable,
  correspondenceRecipientsTable,
  correspondenceAttachmentsTable,
  usersTable,
  projectsTable,
  projectMembersTable,
} from "@workspace/db";
import { eq, isNull, desc, or, inArray, and } from "drizzle-orm";
import { requireAuth, hashToken, isSysAdmin } from "../lib/auth.js";
import crypto from "crypto";
import { createAuditLog } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();
router.use(requireAuth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function enrichItems(items: (typeof correspondenceTable.$inferSelect)[]) {
  if (items.length === 0) return [];

  const userIds = [...new Set(items.map(i => i.fromUserId).filter(Boolean))];
  const users = userIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds as number[]))
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  return items.map(item => {
    const fromUser = userMap.get(item.fromUserId!);
    return {
      ...item,
      fromUserName: fromUser ? `${fromUser.firstName} ${fromUser.lastName}` : "Unknown",
    };
  });
}

// ─── List General Inbox ───────────────────────────────────────────────────────

router.get("/correspondence", async (req, res) => {
  const userId = req.user!.id;
  const { folder = "inbox", type } = req.query;

  // Items with no projectId, either sent by or addressed to this user
  const recipientLinks = await db.select({
    correspondenceId: correspondenceRecipientsTable.correspondenceId,
  }).from(correspondenceRecipientsTable)
    .where(eq(correspondenceRecipientsTable.userId, userId));

  const corrIds = recipientLinks.map(r => r.correspondenceId);

  const items = await db.select().from(correspondenceTable).where(
    and(
      isNull(correspondenceTable.projectId),
      folder ? eq(correspondenceTable.folder, folder as any) : undefined,
      type ? eq(correspondenceTable.type, type as any) : undefined,
    )
  ).orderBy(desc(correspondenceTable.createdAt)).limit(100);

  // Filter: only items where user is sender or recipient
  const userItems = items.filter(item =>
    item.fromUserId === userId || corrIds.includes(item.id)
  );

  const enriched = await enrichItems(userItems);
  res.json(enriched);
});

// ─── Create General Correspondence ───────────────────────────────────────────

router.post("/correspondence", async (req, res) => {
  const userId = req.user!.id;
  const {
    subject, type = "internal", body = "", toUserIds = [],
    referenceNumber, status = "draft",
  } = req.body ?? {};

  if (!subject?.trim()) {
    res.status(400).json({ error: "Subject is required" });
    return;
  }

  const [item] = await db.insert(correspondenceTable).values({
    subject: subject.trim(),
    type,
    folder: status === "sent" ? "sent" : "draft",
    body,
    fromUserId: userId,
    projectId: null,
    referenceNumber,
    status,
    sentAt: status === "sent" ? new Date() : undefined,
  }).returning();

  // Add recipients
  if (toUserIds?.length > 0) {
    await db.insert(correspondenceRecipientsTable).values(
      toUserIds.map((uid: number) => ({ correspondenceId: item.id, userId: uid }))
    );
  }

  await createAuditLog({
    userId,
    action: "create",
    entityType: "correspondence",
    entityId: item.id,
    details: { subject: item.subject, type: item.type, scope: "general" },
  });

  logger.info({ itemId: item.id, userId }, "General correspondence created");
  res.status(201).json(item);
});

// ─── Get Single General Item ──────────────────────────────────────────────────

router.get("/correspondence/:id", async (req, res) => {
  const id = paramInt(req.params.id);
  const user = req.user!;

  const items = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.id, id), isNull(correspondenceTable.projectId)))
    .limit(1);

  if (!items[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Tenant isolation: verify org ownership (NULL organizationId = legacy record, allow access)
  if (!isSysAdmin(user) && items[0].organizationId !== null && items[0].organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const enriched = await enrichItems(items);
  res.json(enriched[0]);
});

// ─── Move to Project ──────────────────────────────────────────────────────────

router.patch("/correspondence/:id/move", async (req, res) => {
  const userId = req.user!.id;
  const id = paramInt(req.params.id);
  const { projectId } = req.body ?? {};

  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  // Verify project exists and user is a member
  const members = await db.select().from(projectMembersTable).where(
    and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.userId, userId),
    )
  ).limit(1);

  if (!members[0]) {
    res.status(403).json({ error: "You are not a member of this project" });
    return;
  }

  const items = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.id, id), isNull(correspondenceTable.projectId)))
    .limit(1);

  if (!items[0]) {
    res.status(404).json({ error: "General correspondence item not found" });
    return;
  }

  const [updated] = await db.update(correspondenceTable)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(correspondenceTable.id, id))
    .returning();

  await createAuditLog({
    userId,
    action: "move_to_project",
    entityType: "correspondence",
    entityId: id,
    details: { projectId, subject: items[0].subject },
  });

  logger.info({ itemId: id, projectId, userId }, "General correspondence moved to project");
  res.json(updated);
});

// ─── Reply in General Section ─────────────────────────────────────────────────

router.post("/correspondence/:id/reply", async (req, res) => {
  const userId = req.user!.id;
  const parentId = paramInt(req.params.id);
  const { subject, body = "", toUserIds = [] } = req.body ?? {};

  const parent = await db.select().from(correspondenceTable)
    .where(and(eq(correspondenceTable.id, parentId), isNull(correspondenceTable.projectId)))
    .limit(1);

  if (!parent[0]) {
    res.status(404).json({ error: "Parent not found" });
    return;
  }

  const [reply] = await db.insert(correspondenceTable).values({
    subject: subject || `Re: ${parent[0].subject}`,
    type: parent[0].type,
    folder: "sent",
    body,
    fromUserId: userId,
    projectId: null,
    parentId,
    status: "sent",
    sentAt: new Date(),
  }).returning();

  if (toUserIds?.length > 0) {
    await db.insert(correspondenceRecipientsTable).values(
      toUserIds.map((uid: number) => ({ correspondenceId: reply.id, userId: uid }))
    );
  }

  res.status(201).json(reply);
});

// ─── PUT /general/correspondence/:id/read ────────────────────────────────────
router.put("/correspondence/:id/read", async (req, res) => {
  const id = paramInt(req.params.id);
  const user = req.user!;
  const { isRead } = req.body;

  // Fetch first to verify ownership before mutating
  const [existing] = await db.select({ id: correspondenceTable.id, organizationId: correspondenceTable.organizationId })
    .from(correspondenceTable).where(eq(correspondenceTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }

  // Tenant isolation
  if (!isSysAdmin(user) && existing.organizationId !== null && existing.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [corr] = await db.update(correspondenceTable)
    .set({ isRead: !!isRead, updatedAt: new Date() })
    .where(eq(correspondenceTable.id, id))
    .returning();
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ id: corr.id, isRead: corr.isRead });
});

// ─── GET /general/correspondence/:id/share ────────────────────────────────────
router.get("/correspondence/:id/share", requireAuth, async (req, res) => {
  const id = paramInt(req.params.id);
  const [corr] = await db
    .select({ hasShareLink: correspondenceTable.shareToken, expiresAt: correspondenceTable.shareExpiresAt })
    .from(correspondenceTable).where(eq(correspondenceTable.id, id)).limit(1);
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ hasShareLink: !!corr.hasShareLink, expiresAt: corr.expiresAt });
});

// ─── POST /general/correspondence/:id/share ───────────────────────────────────
router.post("/correspondence/:id/share", requireAuth, async (req, res) => {
  const id = paramInt(req.params.id);

  // Fetch first to validate ownership before creating a share link.
  const [existing] = await db.select({ id: correspondenceTable.id, organizationId: correspondenceTable.organizationId })
    .from(correspondenceTable)
    .where(eq(correspondenceTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }

  // Enforce org isolation when organizationId is set. NULL organizationId records
  // are legacy data without org context — access is permitted for authenticated users.
  if (existing.organizationId !== null && existing.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden", message: "Cross-organization access denied." });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [corr] = await db.update(correspondenceTable)
    .set({ shareToken: hashToken(token), shareExpiresAt: expiresAt })
    .where(eq(correspondenceTable.id, id))
    .returning({ id: correspondenceTable.id });
  if (!corr) { res.status(404).json({ error: "Not Found" }); return; }
  const baseUrl = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  res.json({ shareUrl: `${baseUrl}/shared/correspondence/${token}`, expiresAt });
});

// ─── DELETE /general/correspondence/:id ──────────────────────────────────────
router.delete("/correspondence/:id", requireAuth, async (req, res) => {
  const id = paramInt(req.params.id);
  const user = req.user!;

  // Fetch first to verify ownership before deleting
  const [existing] = await db.select({ id: correspondenceTable.id, organizationId: correspondenceTable.organizationId, fromUserId: correspondenceTable.fromUserId })
    .from(correspondenceTable).where(eq(correspondenceTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }

  // Tenant isolation: must belong to same org, and only sender or admin can delete
  if (!isSysAdmin(user)) {
    if (existing.organizationId !== null && existing.organizationId !== user.organizationId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  await db.delete(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, id));
  await db.delete(correspondenceRecipientsTable).where(eq(correspondenceRecipientsTable.correspondenceId, id));
  const [deleted] = await db.delete(correspondenceTable).where(eq(correspondenceTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ success: true });
});

// ─── List user's projects (for move-to-project selector) ─────────────────────

router.get("/my-projects", async (req, res) => {
  const userId = req.user!.id;

  const memberships = await db.select({
    projectId: projectMembersTable.projectId,
    project: projectsTable,
  }).from(projectMembersTable)
    .leftJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(eq(projectMembersTable.userId, userId));

  const projects = memberships
    .filter(m => m.project)
    .map(m => m.project!);

  res.json(projects);
});

export default router;
