import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  meetingsTable, meetingAttendeesTable, meetingActionItemsTable,
  meetingAttachmentsTable, usersTable, projectsTable, notificationsTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, inArray, lt, ne, count, isNull, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { sendMeetingCreatedEmail, sendActionItemAssignedEmail } from "../lib/email.js";
import { dispatchNotification } from "../lib/notifications/index.js";
import {param, paramInt, requireInt, queryIntOrNull} from '../lib/params';
import { orgScopedWhere } from "../lib/org-scope.js";

const router = Router();
router.use(requireAuth);

function fmtRef(id: number): string {
  return `MOM-${String(id).padStart(4, "0")}`;
}

// ─── List meetings ─────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const user   = req.user!;
  const orgId  = user.organizationId;

  const projectId = queryIntOrNull(req.query.projectId) ?? undefined;
  const status    = req.query.status as string | undefined;
  const q         = req.query.q as string | undefined;

  // ── Build SQL WHERE conditions ───────────────────────────────────────────────
  // system_owner sees all meetings. All other users are strictly org-scoped.
  // Meetings with null organizationId are system-level and never shown to org users.
  const sqlConditions: SQL<unknown>[] = [];

  if (!isSystemOwner(user)) {
    if (!orgId) {
      res.json({ items: [] });
      return;
    }
    // Enforce tenant isolation at the database level.
    // This covers both project-scoped meetings and org-level meetings (projectId = null).
    sqlConditions.push(eq(meetingsTable.organizationId, orgId) as SQL<unknown>);
  }

  if (projectId) {
    sqlConditions.push(eq(meetingsTable.projectId, projectId) as SQL<unknown>);
  }

  if (status) {
    sqlConditions.push(eq(meetingsTable.status, status as "scheduled" | "in_progress" | "completed" | "cancelled") as SQL<unknown>);
  }

  const rows = await db
    .select({
      meeting: meetingsTable,
      organizer: {
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      },
      project: {
        id: projectsTable.id,
        name: projectsTable.name,
        code: projectsTable.code,
      },
    })
    .from(meetingsTable)
    .leftJoin(usersTable, eq(meetingsTable.organizedById, usersTable.id))
    .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
    .where(sqlConditions.length > 0 ? and(...sqlConditions) : undefined)
    .orderBy(desc(meetingsTable.meetingDate));

  // Apply free-text search in JS (no index needed for low-cardinality searches)
  const filtered = q
    ? rows.filter(row => {
        const lq = q.toLowerCase();
        return (
          row.meeting.title.toLowerCase().includes(lq) ||
          row.meeting.referenceNumber?.toLowerCase().includes(lq) ||
          row.meeting.agenda?.toLowerCase().includes(lq)
        );
      })
    : rows;

  const meetings = filtered.map(r => ({
    ...r.meeting,
    organizer: r.organizer,
    project: r.project,
  }));

  res.json({ items: meetings });
});

// ─── Cross-project action items list ──────────────────────────────────────────
router.get("/action-items", async (req: Request, res: Response): Promise<void> => {
  const user      = req.user!;
  const orgId     = user.organizationId;
  const projectId = queryIntOrNull(req.query.projectId) ?? undefined;
  const status    = req.query.status as string | undefined;
  const overdue   = req.query.overdue === "true";
  const assignee  = queryIntOrNull(req.query.assignee) ?? undefined;

  // ── SQL-level org isolation ───────────────────────────────────────────────────
  // Action items are fetched via their parent meeting. We filter on
  // meetingsTable.organizationId to enforce tenant boundaries at the DB level.
  const sqlConditions: SQL<unknown>[] = [];

  if (!isSystemOwner(user)) {
    if (!orgId) { res.json({ items: [] }); return; }
    sqlConditions.push(eq(meetingsTable.organizationId, orgId) as SQL<unknown>);
  }

  if (projectId) {
    sqlConditions.push(eq(meetingsTable.projectId, projectId) as SQL<unknown>);
  }

  const rows = await db.select({
    item: meetingActionItemsTable,
    meeting: { id: meetingsTable.id, title: meetingsTable.title, referenceNumber: meetingsTable.referenceNumber, projectId: meetingsTable.projectId },
    assignedTo: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName },
    project: { id: projectsTable.id, name: projectsTable.name, code: projectsTable.code },
  })
    .from(meetingActionItemsTable)
    .leftJoin(meetingsTable, eq(meetingActionItemsTable.meetingId, meetingsTable.id))
    .leftJoin(usersTable, eq(meetingActionItemsTable.assignedToId, usersTable.id))
    .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
    .where(sqlConditions.length > 0 ? and(...sqlConditions) : undefined)
    .orderBy(desc(meetingActionItemsTable.createdAt));

  const now = new Date();
  const filtered = rows.filter(r => {
    if (status && r.item.status !== status) return false;
    if (overdue && !(r.item.dueDate && r.item.dueDate < now && r.item.status !== "done")) return false;
    if (assignee && r.item.assignedToId !== assignee) return false;
    return true;
  });

  res.json({
    items: filtered.map(r => ({
      ...r.item,
      meetingTitle: r.meeting?.title,
      meetingRef: r.meeting?.referenceNumber,
      meetingId: r.meeting?.id,
      projectId: r.meeting?.projectId,
      projectName: r.project?.name,
      projectCode: r.project?.code,
      assignedToName: r.assignedTo ? `${r.assignedTo.firstName} ${r.assignedTo.lastName}` : r.item.assignedToName,
      isOverdue: r.item.dueDate ? r.item.dueDate < now && r.item.status !== "done" : false,
    })),
  });
});

// ─── Get meeting detail ────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = requireInt(req.params.id);

  const [row] = await db
    .select({
      meeting: meetingsTable,
      organizer: {
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      },
      project: {
        id: projectsTable.id,
        name: projectsTable.name,
        code: projectsTable.code,
      },
    })
    .from(meetingsTable)
    .leftJoin(usersTable, eq(meetingsTable.organizedById, usersTable.id))
    .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
    .where(eq(meetingsTable.id, id));

  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }

  // Org isolation check
  if (!isSysAdmin(req.user!) && row.meeting.organizationId !== null && row.meeting.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const attendees = await db
    .select({
      id: meetingAttendeesTable.id,
      userId: meetingAttendeesTable.userId,
      name: meetingAttendeesTable.name,
      email: meetingAttendeesTable.email,
      attended: meetingAttendeesTable.attended,
      user: {
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      },
    })
    .from(meetingAttendeesTable)
    .leftJoin(usersTable, eq(meetingAttendeesTable.userId, usersTable.id))
    .where(eq(meetingAttendeesTable.meetingId, id));

  const actionItems = await db
    .select()
    .from(meetingActionItemsTable)
    .where(eq(meetingActionItemsTable.meetingId, id))
    .orderBy(meetingActionItemsTable.createdAt);

  const attachments = await db
    .select()
    .from(meetingAttachmentsTable)
    .where(eq(meetingAttachmentsTable.meetingId, id));

  res.json({
    meeting: { ...row.meeting, organizer: row.organizer, project: row.project },
    attendees,
    actionItems,
    attachments,
  });
});

// ─── Create meeting ────────────────────────────────────────────────────────────
router.post("/", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const { title, projectId, meetingDate, duration, location, meetingLink, agenda, status, attendees } = req.body;

  if (!title?.trim() || !meetingDate) {
    res.status(400).json({ error: "Bad Request", message: "Title and meeting date are required" }); return;
  }

  if (!projectId) {
    res.status(400).json({ error: "Bad Request", message: "A project must be selected for every meeting" }); return;
  }

  const count = await db.select({ id: meetingsTable.id }).from(meetingsTable);
  const ref = fmtRef(count.length + 1);

  const orgId = req.user!.organizationId ?? null;

  const [meeting] = await db.insert(meetingsTable).values({
    title: title.trim(),
    projectId: projectId || null,
    organizationId: orgId,
    organizedById: req.user!.id,
    meetingDate: new Date(meetingDate),
    duration: duration || null,
    location: location?.trim() || null,
    meetingLink: meetingLink?.trim() || null,
    agenda: agenda?.trim() || null,
    status: status || "scheduled",
    referenceNumber: ref,
  }).returning();

  if (attendees?.length) {
    await db.insert(meetingAttendeesTable).values(
      attendees.map((a: any) => ({
        meetingId: meeting.id,
        organizationId: orgId,
        userId: a.userId || null,
        name: a.name || null,
        email: a.email || null,
        attended: false,
      })),
    );
  }

  await createAuditLog({
    userId: req.user!.id,
    action: "create",
    entityType: "meeting",
    entityId: meeting.id,
    organizationId: req.user!.organizationId,
    details: { title: meeting.title, referenceNumber: ref },
  });

  // Notify attendees who are registered users (userId not null, not the organizer)
  if (attendees?.length) {
    const userAttendees = (attendees as any[]).filter(a => a.userId && a.userId !== req.user!.id);
    if (userAttendees.length > 0) {
      let organizerName = "Someone";
      let meetDate = new Date(meetingDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      try {
        const [organizer] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(eq(usersTable.id, req.user!.id));
        organizerName = organizer ? `${organizer.firstName} ${organizer.lastName}`.trim() : "Someone";
        meetDate = new Date(meetingDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        await db.insert(notificationsTable).values(
          userAttendees.map((a: any) => ({
            userId: a.userId as number,
            type: "meeting_assigned" as const,
            title: `Meeting invitation: ${title}`,
            message: `${organizerName} invited you to "${title}" on ${meetDate}`,
            projectId: projectId || null,
            entityType: "meeting",
            entityId: meeting.id,
            actionUrl: `/meetings`,
          }))
        );
      } catch (_) {}
      try {
        const attendeeUsers = await db
          .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(inArray(usersTable.id, userAttendees.map((a: any) => a.userId as number)));
        const [proj] = projectId
          ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
          : [null];
        await dispatchNotification({
          event: "meeting_created",
          recipients: attendeeUsers.map(r => ({ userId: r.id, email: r.email, name: `${r.firstName} ${r.lastName}`.trim() })),
          sendEmail: (to) => sendMeetingCreatedEmail({
            to,
            meetingTitle: title,
            organizerName,
            meetingDate: meetDate,
            location: location?.trim() || undefined,
            meetingLink: meetingLink?.trim() || undefined,
            projectName: proj?.name,
            referenceNumber: ref,
            agenda: agenda?.trim() || undefined,
          }),
        });
      } catch (_) {}
    }
  }

  res.status(201).json({ meeting });
});

// ─── Update meeting ────────────────────────────────────────────────────────────
router.put("/:id", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const id = requireInt(req.params.id);
  const { title, projectId, meetingDate, duration, location, meetingLink, agenda, minutes, status } = req.body;

  // Fetch old state for transition detection and org verification
  const [before] = await db.select({ status: meetingsTable.status, minutes: meetingsTable.minutes, organizationId: meetingsTable.organizationId })
    .from(meetingsTable).where(eq(meetingsTable.id, id));

  if (!before) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (!isSysAdmin(req.user!) && before.organizationId !== null && before.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [meeting] = await db.update(meetingsTable).set({
    ...(title        !== undefined && { title: title.trim() }),
    ...(projectId    !== undefined && { projectId: projectId || null }),
    ...(meetingDate  !== undefined && { meetingDate: new Date(meetingDate) }),
    ...(duration     !== undefined && { duration }),
    ...(location     !== undefined && { location: location?.trim() || null }),
    ...(meetingLink  !== undefined && { meetingLink: meetingLink?.trim() || null }),
    ...(agenda       !== undefined && { agenda: agenda?.trim() || null }),
    ...(minutes      !== undefined && { minutes: minutes?.trim() || null }),
    ...(status       !== undefined && { status }),
    updatedAt: new Date(),
  }).where(eq(meetingsTable.id, id)).returning();

  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }

  // Auto-parse action items from minutes when meeting is first marked completed
  const becomingCompleted = status === "completed" && before?.status !== "completed";
  const minutesText = minutes ?? before?.minutes ?? "";
  if (becomingCompleted && minutesText) {
    try {
      // Count existing action items to avoid duplicates
      const [{ value: existingCount }] = await db
        .select({ value: count() })
        .from(meetingActionItemsTable)
        .where(eq(meetingActionItemsTable.meetingId, id));

      if (Number(existingCount) === 0) {
        const actionLines: string[] = [];
        for (const line of minutesText.split("\n")) {
          const trimmed = line.trim();
          // Match patterns: "Action: ...", "ACTION: ...", "Action Item: ...", "- [ ] ..."
          const matchAction = trimmed.match(/^(?:action(?:\s+item)?|ai)\s*:\s*(.+)/i);
          const matchCheckbox = trimmed.match(/^[-*]\s*\[\s*\]\s*(.+)/i);
          const extracted = matchAction?.[1] ?? matchCheckbox?.[1];
          if (extracted?.trim()) actionLines.push(extracted.trim());
        }
        if (actionLines.length > 0) {
          const defaultDue = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          await db.insert(meetingActionItemsTable).values(
            actionLines.map(title => ({
              meetingId: id,
              organizationId: req.user!.organizationId ?? null,
              title,
              status: "open" as const,
              dueDate: defaultDue,
            }))
          );
        }
      }
    } catch (e) {
      // never block response
    }
  }

  res.json({ meeting });
});

// ─── Update attendee attendance ────────────────────────────────────────────────
router.put("/:id/attendees/:attId", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const attId = requireInt(req.params.attId);
  const { attended } = req.body;
  const caller = req.user!;
  const [updated] = await db.update(meetingAttendeesTable)
    .set({ attended: !!attended })
    .where(orgScopedWhere(caller, meetingAttendeesTable.id, attId, meetingAttendeesTable.organizationId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ attendee: updated });
});

// ─── Add / update action item ──────────────────────────────────────────────────
router.post("/:id/action-items", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const meetingId = requireInt(req.params.id);
  const { title, assignedToId, assignedToName, dueDate, status, priority, notes } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "title required" }); return; }

  // Verify parent meeting belongs to user's org
  const [parentMeeting] = await db.select({ organizationId: meetingsTable.organizationId })
    .from(meetingsTable).where(eq(meetingsTable.id, meetingId)).limit(1);
  if (!parentMeeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (!isSysAdmin(req.user!) && parentMeeting.organizationId !== null && parentMeeting.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [item] = await db.insert(meetingActionItemsTable).values({
    meetingId,
    organizationId: req.user!.organizationId ?? null,
    title: title.trim(),
    assignedToId: assignedToId || null,
    assignedToName: assignedToName?.trim() || null,
    dueDate: dueDate ? new Date(dueDate) : null,
    status: status || "open",
    priority: priority || "medium",
    notes: notes?.trim() || null,
  }).returning();

  // Notify the assigned user (if a registered user, and not the creator)
  if (assignedToId && assignedToId !== req.user!.id) {
    try {
      const [meeting] = await db.select({ title: meetingsTable.title }).from(meetingsTable).where(eq(meetingsTable.id, meetingId)).limit(1);
      const [actor] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Someone";
      await db.insert(notificationsTable).values({
        userId: assignedToId,
        type: "action_item_assigned" as const,
        title: `Action item assigned: ${title.trim()}`,
        message: `${actorName} assigned you an action item from meeting "${meeting?.title ?? ""}": "${title.trim()}"${dueDate ? ` (due ${new Date(dueDate).toLocaleDateString()})` : ""}`,
        entityType: "meeting",
        entityId: meetingId,
        actionUrl: `/meetings`,
      });
      const [assigneeUser] = await db
        .select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, assignedToId)).limit(1);
      if (assigneeUser?.email) {
        await dispatchNotification({
          event: "action_item_assigned",
          recipients: [{ userId: assignedToId, email: assigneeUser.email, name: `${assigneeUser.firstName} ${assigneeUser.lastName}`.trim() }],
          sendEmail: (to) => sendActionItemAssignedEmail({
            to: to[0],
            assigneeName: `${assigneeUser.firstName} ${assigneeUser.lastName}`.trim(),
            assignerName: actorName,
            actionItemTitle: title.trim(),
            meetingTitle: meeting?.title ?? "",
            dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : undefined,
            priority: item.priority ?? undefined,
          }),
        });
      }
    } catch (_) {}
  }

  res.status(201).json({ actionItem: item });
});

router.put("/:id/action-items/:itemId", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const itemId = requireInt(req.params.itemId);
  const { title, assignedToId, assignedToName, dueDate, status, priority, notes } = req.body;
  const caller = req.user!;
  const [item] = await db.update(meetingActionItemsTable).set({
    ...(title          !== undefined && { title: title.trim() }),
    ...(assignedToId   !== undefined && { assignedToId }),
    ...(assignedToName !== undefined && { assignedToName }),
    ...(dueDate        !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    ...(status         !== undefined && { status }),
    ...(priority       !== undefined && { priority }),
    ...(notes          !== undefined && { notes }),
    updatedAt: new Date(),
  }).where(orgScopedWhere(caller, meetingActionItemsTable.id, itemId, meetingActionItemsTable.organizationId)).returning();
  if (!item) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ actionItem: item });
});

// ─── Delete action item ────────────────────────────────────────────────────────
router.delete("/:id/action-items/:itemId", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response): Promise<void> => {
  const itemId = requireInt(req.params.itemId);
  const caller = req.user!;
  const [deleted] = await db.delete(meetingActionItemsTable)
    .where(orgScopedWhere(caller, meetingActionItemsTable.id, itemId, meetingActionItemsTable.organizationId))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ message: "Deleted" });
});

// ─── Delete meeting ────────────────────────────────────────────────────────────
router.delete("/:id", requireRole("admin", "project_manager"), async (req: Request, res: Response): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const [deleted] = await db.delete(meetingsTable)
    .where(orgScopedWhere(caller, meetingsTable.id, id, meetingsTable.organizationId))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ message: "Deleted" });
});

export default router;
