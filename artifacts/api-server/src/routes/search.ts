import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, correspondenceTable, usersTable, foldersTable } from "@workspace/db";
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
    }));
  }

  res.json({
    documents,
    correspondence,
    total: documents.length + correspondence.length,
    query: q,
  });
});

export default router;
