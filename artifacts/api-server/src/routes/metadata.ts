import { Router } from "express";
import { db } from "@workspace/db";
import { metadataFieldsTable } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireOrgScope } from "../lib/org-scope.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();

router.get("/", requireAuth, requireOrgScope, async (req, res) => {
  const orgId = req.orgId;
  const fields = await db
    .select()
    .from(metadataFieldsTable)
    .where(
      orgId
        ? or(
            eq(metadataFieldsTable.organizationId, orgId),
            isNull(metadataFieldsTable.organizationId),
          )
        : isNull(metadataFieldsTable.organizationId),
    )
    .orderBy(metadataFieldsTable.name);
  res.json({ fields });
});

router.post("/", requireAuth, requireOrgScope, async (req, res) => {
  const { name, label, fieldType, options, required, appliesTo } = req.body;
  if (!name || !label || !fieldType) {
    res.status(400).json({ error: "Bad Request", message: "name, label, fieldType required" });
    return;
  }
  const orgId = req.orgId ?? null;
  const [field] = await db
    .insert(metadataFieldsTable)
    .values({
      organizationId: orgId,
      name,
      label,
      fieldType,
      options: options || [],
      required: required ?? false,
      appliesTo: appliesTo || "document",
    })
    .returning();
  res.status(201).json(field);
});

router.delete("/:id", requireAuth, requireOrgScope, async (req, res) => {
  const id = paramInt(req.params.id);
  const orgId = req.orgId;
  const where = orgId
    ? and(eq(metadataFieldsTable.id, id), eq(metadataFieldsTable.organizationId, orgId))
    : eq(metadataFieldsTable.id, id);
  await db.delete(metadataFieldsTable).where(where);
  res.status(204).send();
});

export default router;
