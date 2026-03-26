import { Router } from "express";
import { db } from "@workspace/db";
import {
  transmittalsTable, transmittalItemsTable, documentsTable, usersTable
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/transmittal/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.query as Record<string, string>;

  const [transmittal] = await db
    .select()
    .from(transmittalsTable)
    .where(eq(transmittalsTable.shareToken, token))
    .limit(1);

  if (!transmittal) {
    res.status(404).json({ error: "Link not found or has been revoked" });
    return;
  }

  if (transmittal.shareExpiresAt && transmittal.shareExpiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired" });
    return;
  }

  if (transmittal.sharePasswordHash) {
    if (!password) {
      res.status(401).json({ error: "Password required", passwordRequired: true });
      return;
    }
    const hash = await hashPassword(password);
    if (hash !== transmittal.sharePasswordHash) {
      res.status(403).json({ error: "Incorrect password" });
      return;
    }
  }

  const items = await db
    .select({
      id: transmittalItemsTable.id,
      documentId: transmittalItemsTable.documentId,
      revision: transmittalItemsTable.revision,
      copies: transmittalItemsTable.copies,
      purpose: transmittalItemsTable.purpose,
      documentNumber: documentsTable.documentNumber,
      documentTitle: documentsTable.title,
      documentType: documentsTable.documentType,
      discipline: documentsTable.discipline,
    })
    .from(transmittalItemsTable)
    .leftJoin(documentsTable, eq(transmittalItemsTable.documentId, documentsTable.id))
    .where(eq(transmittalItemsTable.transmittalId, transmittal.id));

  const createdBy = transmittal.createdById
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, transmittal.createdById)).limit(1)
    : [];

  await createAuditLog({
    userId: 0,
    action: "view",
    entityType: "transmittal",
    entityId: transmittal.id,
    details: { sharedAccess: true, token },
  }).catch(() => {});

  res.json({
    id: transmittal.id,
    transmittalNumber: transmittal.transmittalNumber,
    subject: transmittal.subject,
    description: transmittal.description,
    status: transmittal.status,
    purpose: transmittal.purpose,
    toExternal: transmittal.toExternal,
    sentAt: transmittal.sentAt,
    dueDate: transmittal.dueDate,
    createdAt: transmittal.createdAt,
    createdBy: createdBy[0] ? `${createdBy[0].firstName} ${createdBy[0].lastName}` : "Unknown",
    items,
    expiresAt: transmittal.shareExpiresAt,
  });
});

export default router;
