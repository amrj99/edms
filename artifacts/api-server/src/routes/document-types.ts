import { Router } from "express";
import { db, documentTypesTable, normalizeDocTypeCode } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { requireInt } from "../lib/params";

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const rows = await db
      .select()
      .from(documentTypesTable)
      .where(eq(documentTypesTable.organizationId, orgId))
      .orderBy(asc(documentTypesTable.name));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "[document-types] GET / error");
    res.status(500).json({ error: "Failed to fetch document types" });
  }
});

router.post("/", requireRole("document_controller", "project_manager", "admin", "system_owner"), async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { code, name, isActive } = req.body;

    if (!code?.trim() || !name?.trim()) {
      res.status(400).json({ error: "Bad Request", message: "code and name are required" });
      return;
    }

    const normalizedCode = normalizeDocTypeCode(code);

    const [row] = await db
      .insert(documentTypesTable)
      .values({
        organizationId: orgId,
        code: normalizedCode,
        name: name.trim(),
        isActive: isActive ?? true,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") {
      res.status(409).json({ error: "Conflict", message: `Document type code "${normalizeDocTypeCode(req.body.code ?? "")}" already exists for this organization.` });
      return;
    }
    logger.error({ err }, "[document-types] POST / error");
    res.status(500).json({ error: "Failed to create document type" });
  }
});

router.patch("/:id", requireRole("document_controller", "project_manager", "admin", "system_owner"), async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const id = requireInt(req.params.id);
    const { code, name, isActive } = req.body;

    if (code !== undefined) {
      res.status(400).json({ error: "Bad Request", message: "Document type code cannot be changed after creation" });
      return;
    }

    const updates: Partial<typeof documentTypesTable.$inferInsert> = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!name?.trim()) {
        res.status(400).json({ error: "Bad Request", message: "name cannot be empty" });
        return;
      }
      updates.name = name.trim();
    }
    if (isActive !== undefined) updates.isActive = isActive;

    const [row] = await db
      .update(documentTypesTable)
      .set(updates)
      .where(and(eq(documentTypesTable.id, id), eq(documentTypesTable.organizationId, orgId)))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Document type not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    logger.error({ err }, "[document-types] PATCH /:id error");
    res.status(500).json({ error: "Failed to update document type" });
  }
});

export default router;
