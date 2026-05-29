import { Router } from "express";
import { db } from "@workspace/db";
import { emitToUser, emitToChatGroup } from "../lib/socket.js";
import {
  chatGroupsTable,
  chatGroupMembersTable,
  chatMessagesTable,
  chatMessageReadsTable,
  usersTable,
  projectsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc, gt, or, ilike, isNull, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isMember(groupId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: chatGroupMembersTable.id })
    .from(chatGroupMembersTable)
    .where(and(eq(chatGroupMembersTable.groupId, groupId), eq(chatGroupMembersTable.userId, userId)));
  return !!row;
}

async function isGroupAdmin(groupId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ role: chatGroupMembersTable.role })
    .from(chatGroupMembersTable)
    .where(and(eq(chatGroupMembersTable.groupId, groupId), eq(chatGroupMembersTable.userId, userId)));
  return row?.role === "admin";
}

async function enrichMessages(messages: typeof chatMessagesTable.$inferSelect[], viewerId: number) {
  if (messages.length === 0) return [];

  const userIds = [...new Set(messages.map((m) => m.userId))];
  const users = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  const userMap = Object.fromEntries(users.map((u) => [u.id, { ...u, name: `${u.firstName} ${u.lastName}`.trim() }]));

  const msgIds = messages.map((m) => m.id);
  const reads = await db
    .select({ messageId: chatMessageReadsTable.messageId })
    .from(chatMessageReadsTable)
    .where(and(inArray(chatMessageReadsTable.messageId, msgIds), eq(chatMessageReadsTable.userId, viewerId)));
  const readSet = new Set(reads.map((r) => r.messageId));

  return messages.map((m) => ({
    ...m,
    content: m.isDeleted ? null : m.content,
    user: userMap[m.userId] ?? null,
    isRead: readSet.has(m.id),
  }));
}

// ─── GET /api/chat/groups ──────────────────────────────────────────────────────
router.get("/groups", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId = req.user!.organizationId;

  if (!orgId) {
    res.json({ groups: [] });
    return;
  }

  const memberships = await db
    .select({ groupId: chatGroupMembersTable.groupId })
    .from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.userId, userId));

  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) {
    res.json({ groups: [] });
    return;
  }

  const groups = await db
    .select({
      id: chatGroupsTable.id,
      name: chatGroupsTable.name,
      description: chatGroupsTable.description,
      type: chatGroupsTable.type,
      projectId: chatGroupsTable.projectId,
      department: chatGroupsTable.department,
      createdById: chatGroupsTable.createdById,
      isArchived: chatGroupsTable.isArchived,
      createdAt: chatGroupsTable.createdAt,
      updatedAt: chatGroupsTable.updatedAt,
    })
    .from(chatGroupsTable)
    .where(and(inArray(chatGroupsTable.id, groupIds), eq(chatGroupsTable.organizationId, orgId!), eq(chatGroupsTable.isArchived, false)));

  const projectIds = [...new Set(groups.filter((g) => g.projectId).map((g) => g.projectId!))];
  let projectMap: Record<number, string> = {};
  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds));
    projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  }

  // Get unread counts for each group
  const unreadCounts: Record<number, number> = {};
  for (const gId of groupIds) {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.groupId, gId),
          eq(chatMessagesTable.isDeleted, false),
          sql`${chatMessagesTable.id} not in (
            select message_id from chat_message_reads where user_id = ${userId}
          )`
        )
      );
    unreadCounts[gId] = result?.count ?? 0;
  }

  res.json({
    groups: groups.map((g) => ({
      ...g,
      projectName: g.projectId ? (projectMap[g.projectId] ?? null) : null,
      unreadCount: unreadCounts[g.id] ?? 0,
    })),
  });
});

// ─── POST /api/chat/groups ─────────────────────────────────────────────────────
router.post("/groups", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId = req.user!.organizationId;
  const { name, description, type = "general", projectId, department, memberIds = [] } = req.body;

  if (!orgId) {
    res.status(400).json({ error: "You must be a member of an organization to create chat groups." });
    return;
  }

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [group] = await db
    .insert(chatGroupsTable)
    .values({ name: name.trim(), description, type, organizationId: orgId, projectId: projectId ?? null, department: department ?? null, createdById: userId })
    .returning();

  // Add creator as admin
  await db.insert(chatGroupMembersTable).values({ groupId: group.id, userId, role: "admin" });

  // Add other initial members
  const otherMembers = (memberIds as number[]).filter((id) => id !== userId);
  if (otherMembers.length > 0) {
    await db.insert(chatGroupMembersTable).values(otherMembers.map((uid) => ({ groupId: group.id, userId: uid, role: "member" as const })));
  }

  await createAuditLog({ userId, action: "create", entityType: "chat_group", entityId: group.id, details: { name: group.name } });

  res.status(201).json({ group });
});

// ─── GET /api/chat/groups/:id ──────────────────────────────────────────────────
router.get("/groups/:id", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!(await isMember(groupId, userId))) {
    res.status(403).json({ error: "Not a member of this group" });
    return;
  }

  const [group] = await db.select().from(chatGroupsTable).where(eq(chatGroupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = await db
    .select({
      id: chatGroupMembersTable.id,
      userId: chatGroupMembersTable.userId,
      role: chatGroupMembersTable.role,
      joinedAt: chatGroupMembersTable.joinedAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(chatGroupMembersTable)
    .leftJoin(usersTable, eq(chatGroupMembersTable.userId, usersTable.id))
    .where(eq(chatGroupMembersTable.groupId, groupId));

  let projectName: string | null = null;
  if (group.projectId) {
    const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, group.projectId));
    projectName = proj?.name ?? null;
  }

  res.json({ group: { ...group, projectName }, members: members.map(m => ({ ...m, name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() })) });
});

// ─── PUT /api/chat/groups/:id ──────────────────────────────────────────────────
router.put("/groups/:id", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = req.user!.role;
  const canEdit = (await isGroupAdmin(groupId, userId)) || role === "admin" || role === "system_owner";
  if (!canEdit) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  const { name, description, isArchived } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description;
  if (isArchived !== undefined) updates.isArchived = isArchived;

  const [updated] = await db.update(chatGroupsTable).set(updates).where(eq(chatGroupsTable.id, groupId)).returning();
  res.json({ group: updated });
});

// ─── DELETE /api/chat/groups/:id ───────────────────────────────────────────────
router.delete("/groups/:id", requireRole("admin", "system_owner", "project_manager", "document_controller"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = req.user!.role;
  const canDelete = (await isGroupAdmin(groupId, userId)) || role === "admin" || role === "system_owner";
  if (!canDelete) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  await db.delete(chatGroupsTable).where(eq(chatGroupsTable.id, groupId));
  await createAuditLog({ userId, action: "delete", entityType: "chat_group", entityId: groupId, details: {} });
  res.json({ success: true });
});

// ─── GET /api/chat/groups/:id/members ─────────────────────────────────────────
router.get("/groups/:id/members", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!(await isMember(groupId, userId))) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({
      id: chatGroupMembersTable.id,
      userId: chatGroupMembersTable.userId,
      role: chatGroupMembersTable.role,
      joinedAt: chatGroupMembersTable.joinedAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(chatGroupMembersTable)
    .leftJoin(usersTable, eq(chatGroupMembersTable.userId, usersTable.id))
    .where(eq(chatGroupMembersTable.groupId, groupId));

  res.json({ members: members.map(m => ({ ...m, name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() })) });
});

// ─── POST /api/chat/groups/:id/members ────────────────────────────────────────
router.post("/groups/:id/members", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = req.user!.role;
  const canManage = (await isGroupAdmin(groupId, userId)) || role === "admin" || role === "system_owner";
  if (!canManage) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: "userIds array required" });
    return;
  }

  const existing = await db
    .select({ userId: chatGroupMembersTable.userId })
    .from(chatGroupMembersTable)
    .where(and(eq(chatGroupMembersTable.groupId, groupId), inArray(chatGroupMembersTable.userId, userIds)));
  const existingSet = new Set(existing.map((e) => e.userId));
  const toAdd = (userIds as number[]).filter((id) => !existingSet.has(id));

  if (toAdd.length > 0) {
    await db.insert(chatGroupMembersTable).values(toAdd.map((uid) => ({ groupId, userId: uid, role: "member" as const })));
  }

  res.json({ added: toAdd.length });
});

// ─── DELETE /api/chat/groups/:id/members/:userId ───────────────────────────────
router.delete("/groups/:id/members/:memberId", async (req, res): Promise<void> => {
  const currentUserId = req.user!.id;
  const groupId = paramInt(req.params.id);
  const targetUserId = paramInt(req.params.memberId);

  const role = req.user!.role;
  const canManage = currentUserId === targetUserId || (await isGroupAdmin(groupId, currentUserId)) || role === "admin" || role === "system_owner";
  if (!canManage) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  await db.delete(chatGroupMembersTable).where(and(eq(chatGroupMembersTable.groupId, groupId), eq(chatGroupMembersTable.userId, targetUserId)));
  res.json({ success: true });
});

// ─── GET /api/chat/groups/:id/messages ────────────────────────────────────────
router.get("/groups/:id/messages", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!(await isMember(groupId, userId))) { res.status(403).json({ error: "Not a member" }); return; }

  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 100);
  const before = req.query.before ? parseInt(String(req.query.before)) : null;
  const after = req.query.after ? parseInt(String(req.query.after)) : null;
  const search = req.query.q ? String(req.query.q).trim() : null;
  const parentId = req.query.parentId ? parseInt(String(req.query.parentId)) : undefined;

  const conditions = [eq(chatMessagesTable.groupId, groupId)];
  if (before) conditions.push(sql`${chatMessagesTable.id} < ${before}`);
  if (after) conditions.push(gt(chatMessagesTable.id, after));
  if (search) conditions.push(ilike(chatMessagesTable.content, `%${search}%`));
  if (parentId !== undefined) {
    if (parentId === 0) {
      conditions.push(isNull(chatMessagesTable.parentId));
    } else {
      conditions.push(eq(chatMessagesTable.parentId, parentId));
    }
  }

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(and(...conditions))
    .orderBy(desc(chatMessagesTable.id))
    .limit(limit);

  const enriched = await enrichMessages(messages.reverse(), userId);
  res.json({ messages: enriched, hasMore: messages.length === limit });
});

// ─── POST /api/chat/groups/:id/messages ───────────────────────────────────────
router.post("/groups/:id/messages", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId = req.user!.organizationId!;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!(await isMember(groupId, userId))) { res.status(403).json({ error: "Not a member" }); return; }

  const { content, parentId, messageType = "text", fileUrl, fileName, fileSize } = req.body;
  if (!content?.trim() && messageType === "text") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [message] = await db
    .insert(chatMessagesTable)
    .values({
      groupId,
      userId,
      content: content?.trim() ?? "",
      parentId: parentId ?? null,
      messageType,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      fileSize: fileSize ?? null,
    })
    .returning();

  // Update group updatedAt
  await db.update(chatGroupsTable).set({ updatedAt: new Date() }).where(eq(chatGroupsTable.id, groupId));

  // Auto-read for sender
  await db.insert(chatMessageReadsTable).values({ messageId: message.id, userId });

  // Audit log
  await createAuditLog({ userId, action: "create", entityType: "chat_message", entityId: message.id, details: { groupId } });

  // Create notifications for other group members (fire-and-forget, non-blocking)
  (async () => {
    try {
      const notifMembers = await db
        .select({ userId: chatGroupMembersTable.userId })
        .from(chatGroupMembersTable)
        .where(and(eq(chatGroupMembersTable.groupId, groupId), ne(chatGroupMembersTable.userId, userId)));

      const [sender] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const [grp] = await db
        .select({ name: chatGroupsTable.name })
        .from(chatGroupsTable)
        .where(eq(chatGroupsTable.id, groupId));

      if (notifMembers.length > 0) {
        const notifRows = await db.insert(notificationsTable).values(
          notifMembers.map((m) => ({
            userId: m.userId,
            type: "chat_message" as const,
            title: `New message in ${grp?.name ?? "Chat"}`,
            message: `${sender ? `${sender.firstName} ${sender.lastName}`.trim() : "Someone"}: ${(content ?? "").substring(0, 80)}`,
            entityType: "chat_group",
            entityId: groupId,
            actionUrl: `/chat?group=${groupId}`,
          }))
        ).returning();
        // Emit notification badge update to each member
        for (const n of notifRows) emitToUser(n.userId, "notification:new", n);
      }
    } catch (err) {
      // Notifications should never block message sending
      console.error("Chat notification error:", err);
    }
  })();

  const [enriched] = await enrichMessages([message], userId);

  // Real-time: broadcast the new message to all clients in the group room
  emitToChatGroup(groupId, "chat:message", enriched);

  res.status(201).json({ message: enriched });
});

// ─── DELETE /api/chat/groups/:id/messages/:msgId ───────────────────────────────
router.delete("/groups/:id/messages/:msgId", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  const msgId = paramInt(req.params.msgId);

  const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, msgId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  const role = req.user!.role;
  const canDelete = msg.userId === userId || (await isGroupAdmin(groupId, userId)) || role === "admin" || role === "system_owner";
  if (!canDelete) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  await db.update(chatMessagesTable).set({ isDeleted: true }).where(eq(chatMessagesTable.id, msgId));
  res.json({ success: true });
});

// ─── POST /api/chat/groups/:id/messages/:msgId/read ───────────────────────────
router.post("/groups/:id/messages/:msgId/read", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const msgId = paramInt(req.params.msgId);

  const [existing] = await db
    .select({ id: chatMessageReadsTable.id })
    .from(chatMessageReadsTable)
    .where(and(eq(chatMessageReadsTable.messageId, msgId), eq(chatMessageReadsTable.userId, userId)));

  if (!existing) {
    await db.insert(chatMessageReadsTable).values({ messageId: msgId, userId });
  }
  res.json({ success: true });
});

// ─── POST /api/chat/groups/:id/read-all ───────────────────────────────────────
router.post("/groups/:id/read-all", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const groupId = paramInt(req.params.id);
  if (!Number.isInteger(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!(await isMember(groupId, userId))) { res.status(403).json({ error: "Not a member" }); return; }

  const unread = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.groupId, groupId),
        eq(chatMessagesTable.isDeleted, false),
        sql`${chatMessagesTable.id} not in (select message_id from chat_message_reads where user_id = ${userId})`
      )
    );

  if (unread.length > 0) {
    await db.insert(chatMessageReadsTable).values(unread.map((m) => ({ messageId: m.id, userId })));
  }

  res.json({ marked: unread.length });
});

// ─── GET /api/chat/unread ──────────────────────────────────────────────────────
router.get("/unread", async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const memberships = await db
    .select({ groupId: chatGroupMembersTable.groupId })
    .from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.userId, userId));

  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) {
    res.json({ total: 0, byGroup: {} });
    return;
  }

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(
      and(
        inArray(chatMessagesTable.groupId, groupIds),
        eq(chatMessagesTable.isDeleted, false),
        sql`${chatMessagesTable.id} not in (select message_id from chat_message_reads where user_id = ${userId})`
      )
    );

  res.json({ total: result?.count ?? 0 });
});

// ─── GET /api/chat/users ─── list org users to add to groups ─────────────────
router.get("/users", async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId!;
  const rawUsers = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.organizationId, orgId));
  const users = rawUsers.map(u => ({ ...u, name: `${u.firstName} ${u.lastName}`.trim() }));
  res.json({ users });
});

export default router;
