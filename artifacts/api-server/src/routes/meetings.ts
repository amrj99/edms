import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  meetingsTable, meetingAttendeesTable, meetingActionItemsTable,
  meetingAttachmentsTable, usersTable, projectsTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();
router.use(requireAuth);

function fmtRef(id: number): string {
  return `MOM-${String(id).padStart(4, "0")}`;
}

// ─── List meetings ─────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orgId  = req.user!.organizationId;

  const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
  const status    = req.query.status as string | undefined;
  const q         = req.query.q as string | undefined;

  let projectIds: number[] | undefined;
  if (projectId) {
    projectIds = [projectId];
  } else if (orgId) {
    const projs = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, orgId));
    projectIds = projs.map(p => p.id);
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
    .orderBy(desc(meetingsTable.meetingDate));

  const filtered = rows.filter(row => {
    if (status && row.meeting.status !== status) return false;
    if (projectIds && row.meeting.projectId && !projectIds.includes(row.meeting.projectId)) return false;
    if (q) {
      const lq = q.toLowerCase();
      return (
        row.meeting.title.toLowerCase().includes(lq) ||
        row.meeting.referenceNumber?.toLowerCase().includes(lq) ||
        row.meeting.agenda?.toLowerCase().includes(lq)
      );
    }
    return true;
  });

  const meetings = filtered.map(r => ({
    ...r.meeting,
    organizer: r.organizer,
    project: r.project,
  }));

  res.json({ meetings });
});

// ─── Get meeting detail ────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

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

  if (!row) return res.status(404).json({ error: "Meeting not found" });

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
router.post("/", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response) => {
  const { title, projectId, meetingDate, duration, location, agenda, status, attendees } = req.body;

  if (!title?.trim() || !meetingDate) {
    return res.status(400).json({ error: "Bad Request", message: "Title and meeting date are required" });
  }

  const count = await db.select({ id: meetingsTable.id }).from(meetingsTable);
  const ref = fmtRef(count.length + 1);

  const [meeting] = await db.insert(meetingsTable).values({
    title: title.trim(),
    projectId: projectId || null,
    organizedById: req.user!.id,
    meetingDate: new Date(meetingDate),
    duration: duration || null,
    location: location?.trim() || null,
    agenda: agenda?.trim() || null,
    status: status || "scheduled",
    referenceNumber: ref,
  }).returning();

  if (attendees?.length) {
    await db.insert(meetingAttendeesTable).values(
      attendees.map((a: any) => ({
        meetingId: meeting.id,
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

  res.status(201).json({ meeting });
});

// ─── Update meeting ────────────────────────────────────────────────────────────
router.put("/:id", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { title, projectId, meetingDate, duration, location, agenda, minutes, status } = req.body;

  const [meeting] = await db.update(meetingsTable).set({
    ...(title       !== undefined && { title: title.trim() }),
    ...(projectId   !== undefined && { projectId: projectId || null }),
    ...(meetingDate !== undefined && { meetingDate: new Date(meetingDate) }),
    ...(duration    !== undefined && { duration }),
    ...(location    !== undefined && { location: location?.trim() || null }),
    ...(agenda      !== undefined && { agenda: agenda?.trim() || null }),
    ...(minutes     !== undefined && { minutes: minutes?.trim() || null }),
    ...(status      !== undefined && { status }),
    updatedAt: new Date(),
  }).where(eq(meetingsTable.id, id)).returning();

  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  res.json({ meeting });
});

// ─── Update attendee attendance ────────────────────────────────────────────────
router.put("/:id/attendees/:attId", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response) => {
  const attId = parseInt(req.params.attId);
  const { attended } = req.body;
  const [updated] = await db.update(meetingAttendeesTable)
    .set({ attended: !!attended })
    .where(eq(meetingAttendeesTable.id, attId))
    .returning();
  res.json({ attendee: updated });
});

// ─── Add / update action item ──────────────────────────────────────────────────
router.post("/:id/action-items", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response) => {
  const meetingId = parseInt(req.params.id);
  const { title, assignedToId, assignedToName, dueDate, status, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title required" });

  const [item] = await db.insert(meetingActionItemsTable).values({
    meetingId,
    title: title.trim(),
    assignedToId: assignedToId || null,
    assignedToName: assignedToName?.trim() || null,
    dueDate: dueDate ? new Date(dueDate) : null,
    status: status || "open",
    notes: notes?.trim() || null,
  }).returning();

  res.status(201).json({ actionItem: item });
});

router.put("/:id/action-items/:itemId", requireRole("admin", "project_manager", "document_controller"), async (req: Request, res: Response) => {
  const itemId = parseInt(req.params.itemId);
  const { title, assignedToId, assignedToName, dueDate, status, notes } = req.body;
  const [item] = await db.update(meetingActionItemsTable).set({
    ...(title          !== undefined && { title: title.trim() }),
    ...(assignedToId   !== undefined && { assignedToId }),
    ...(assignedToName !== undefined && { assignedToName }),
    ...(dueDate        !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    ...(status         !== undefined && { status }),
    ...(notes          !== undefined && { notes }),
  }).where(eq(meetingActionItemsTable.id, itemId)).returning();
  res.json({ actionItem: item });
});

// ─── Delete meeting ────────────────────────────────────────────────────────────
router.delete("/:id", requireRole("admin", "project_manager"), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
