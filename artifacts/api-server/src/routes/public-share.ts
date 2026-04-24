import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  transmittalsTable, transmittalItemsTable, documentsTable, usersTable,
  correspondenceTable, correspondenceAttachmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyPassword, hashToken } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

// ─── Per-token rate limiter ───────────────────────────────────────────────────
// Limits password-guessing attempts on share links to 10 per 15 minutes per
// token. Keyed by token param (not IP) so VPN-hopping doesn't bypass the limit.
//
// Storage: MemoryStore (express-rate-limit default) — in-process, not shared.
// Single-instance VPS deployment: this is correct and sufficient.
// Multi-instance / horizontal scale: replace with a Redis-backed store
//   (e.g. rate-limit-redis) so counters are consistent across all processes.
const shareTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `share:${req.params.token ?? "unknown"}`,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too Many Attempts",
      message: "Too many access attempts for this link. Please try again later.",
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Transmittal ──────────────────────────────────────────────────────────────
router.get("/transmittal/:token", shareTokenLimiter, async (req, res) => {
  const { token } = req.params;
  const { password } = req.query as Record<string, string>;

  const [transmittal] = await db
    .select()
    .from(transmittalsTable)
    .where(eq(transmittalsTable.shareToken, hashToken(token)))
    .limit(1);

  // Return a uniform 401/403 for non-existent tokens so an attacker cannot
  // distinguish "token not found" from "token exists but is password-protected".
  if (!transmittal) {
    if (password) {
      res.status(403).json({ error: "Incorrect password" });
    } else {
      res.status(401).json({ error: "Access required", passwordRequired: true });
    }
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
    const valid = await verifyPassword(password, transmittal.sharePasswordHash);
    if (!valid) {
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

// ─── Document ─────────────────────────────────────────────────────────────────
router.get("/document/:token", shareTokenLimiter, async (req, res) => {
  const { token } = req.params;
  const { password } = req.query as Record<string, string>;

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.shareToken, hashToken(token)))
    .limit(1);

  if (!doc) {
    if (password) {
      res.status(403).json({ error: "Incorrect password" });
    } else {
      res.status(401).json({ error: "Access required", passwordRequired: true });
    }
    return;
  }

  if (doc.shareExpiresAt && doc.shareExpiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired" });
    return;
  }

  if (doc.sharePasswordHash) {
    if (!password) {
      res.status(401).json({ error: "Password required", passwordRequired: true });
      return;
    }
    const valid = await verifyPassword(password, doc.sharePasswordHash);
    if (!valid) {
      res.status(403).json({ error: "Incorrect password" });
      return;
    }
  }

  const createdBy = doc.createdById
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1)
    : [];

  await createAuditLog({
    userId: 0, action: "view", entityType: "document", entityId: doc.id,
    details: { sharedAccess: true, token },
  }).catch(() => {});

  res.json({
    id: doc.id,
    documentNumber: doc.documentNumber,
    title: doc.title,
    documentType: doc.documentType,
    discipline: doc.discipline,
    revision: doc.revision,
    status: doc.status,
    description: doc.description,
    fileName: doc.fileName,
    fileUrl: doc.fileUrl,
    fileSize: doc.fileSize,
    createdAt: doc.createdAt,
    createdBy: createdBy[0] ? `${createdBy[0].firstName} ${createdBy[0].lastName}` : "Unknown",
    expiresAt: doc.shareExpiresAt,
  });
});

// ─── Correspondence ───────────────────────────────────────────────────────────
router.get("/correspondence/:token", shareTokenLimiter, async (req, res) => {
  const { token } = req.params;
  const { password } = req.query as Record<string, string>;

  const [corr] = await db
    .select()
    .from(correspondenceTable)
    .where(eq(correspondenceTable.shareToken, hashToken(token)))
    .limit(1);

  if (!corr) {
    if (password) {
      res.status(403).json({ error: "Incorrect password" });
    } else {
      res.status(401).json({ error: "Access required", passwordRequired: true });
    }
    return;
  }

  if (corr.shareExpiresAt && corr.shareExpiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired" });
    return;
  }

  if (corr.sharePasswordHash) {
    if (!password) {
      res.status(401).json({ error: "Password required", passwordRequired: true });
      return;
    }
    const valid = await verifyPassword(password, corr.sharePasswordHash);
    if (!valid) {
      res.status(403).json({ error: "Incorrect password" });
      return;
    }
  }

  const attachments = await db
    .select()
    .from(correspondenceAttachmentsTable)
    .where(eq(correspondenceAttachmentsTable.correspondenceId, corr.id));

  const fromUser = corr.fromUserId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable).where(eq(usersTable.id, corr.fromUserId)).limit(1)
    : [];

  await createAuditLog({
    userId: 0, action: "view", entityType: "correspondence", entityId: corr.id,
    details: { sharedAccess: true, token },
  }).catch(() => {});

  res.json({
    id: corr.id,
    referenceNumber: corr.referenceNumber,
    subject: corr.subject,
    type: corr.type,
    body: corr.body,
    status: corr.status,
    priority: corr.priority,
    dueDate: corr.dueDate,
    sentAt: corr.sentAt,
    createdAt: corr.createdAt,
    fromUser: fromUser[0] ? `${fromUser[0].firstName} ${fromUser[0].lastName}` : "Unknown",
    attachments: attachments.map(a => ({ id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize })),
    expiresAt: corr.shareExpiresAt,
  });
});

export default router;
