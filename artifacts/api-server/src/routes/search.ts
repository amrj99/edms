import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, correspondenceTable, usersTable, foldersTable, meetingsTable, projectsTable } from "@workspace/db";
import { eq, ilike, or, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { q, projectId, type, discipline, status } = req.query;

  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Bad Request", message: "q parameter is required" });
    return;
  }

  const searchPattern = `%${q}%`;
  const pId = projectId ? parseInt(projectId as string) : undefined;

  let documents: any[] = [];
  let correspondence: any[] = [];
  let meetings: any[] = [];
  let projects: any[] = [];

  if (!type || type === "document" || type === "all") {
    const docFilter = and(
      pId ? eq(documentsTable.projectId, pId) : undefined,
      or(
        ilike(documentsTable.title, searchPattern),
        ilike(documentsTable.documentNumber, searchPattern),
        ilike(documentsTable.discipline, searchPattern),
        ilike(documentsTable.documentType, searchPattern),
        ilike(documentsTable.description, searchPattern),
      )
    );

    const docs = await db.select({
      doc: documentsTable,
      createdBy: usersTable,
      folder: foldersTable,
    }).from(documentsTable)
      .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
      .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
      .where(docFilter)
      .orderBy(desc(documentsTable.updatedAt))
      .limit(20);

    let filteredDocs = docs;
    if (discipline) filteredDocs = filteredDocs.filter(d => d.doc.discipline === discipline);
    if (status) filteredDocs = filteredDocs.filter(d => d.doc.status === status);

    documents = filteredDocs.map(({ doc, createdBy, folder }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName: folder?.name,
      resultType: "document",
    }));
  }

  if (!type || type === "correspondence" || type === "all") {
    const corrFilter = and(
      pId ? eq(correspondenceTable.projectId, pId) : undefined,
      or(
        ilike(correspondenceTable.subject, searchPattern),
        ilike(correspondenceTable.body, searchPattern),
        ilike(correspondenceTable.referenceNumber, searchPattern),
      )
    );

    const corrItems = await db.select().from(correspondenceTable)
      .where(corrFilter)
      .orderBy(desc(correspondenceTable.updatedAt))
      .limit(20);

    correspondence = corrItems.map(c => ({
      ...c,
      toUserIds: [],
      toUserNames: [],
      attachments: [],
      fromUserName: undefined,
      resultType: "correspondence",
    }));
  }

  if (!type || type === "meeting" || type === "all") {
    const mtgFilter = and(
      pId ? eq(meetingsTable.projectId, pId) : undefined,
      or(
        ilike(meetingsTable.title, searchPattern),
        ilike(meetingsTable.agenda, searchPattern),
        ilike(meetingsTable.location, searchPattern),
        ilike(meetingsTable.referenceNumber, searchPattern),
        ilike(meetingsTable.minutes, searchPattern),
      )
    );

    const mtgRows = await db.select({
      meeting: meetingsTable,
      project: {
        id: projectsTable.id,
        name: projectsTable.name,
        code: projectsTable.code,
      },
    }).from(meetingsTable)
      .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
      .where(mtgFilter)
      .orderBy(desc(meetingsTable.meetingDate))
      .limit(20);

    meetings = mtgRows.map(({ meeting, project }) => ({
      ...meeting,
      project,
      resultType: "meeting",
    }));
  }

  if (!type || type === "project" || type === "all") {
    const projFilter = or(
      ilike(projectsTable.name, searchPattern),
      ilike(projectsTable.code, searchPattern),
      ilike(projectsTable.description, searchPattern),
    );

    const projRows = await db.select().from(projectsTable)
      .where(projFilter)
      .orderBy(desc(projectsTable.updatedAt))
      .limit(10);

    projects = projRows.map(p => ({ ...p, resultType: "project" }));
  }

  res.json({
    documents,
    correspondence,
    meetings,
    projects,
    total: documents.length + correspondence.length + meetings.length + projects.length,
    query: q,
  });
});

export default router;
