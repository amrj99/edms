import { Router } from "express";
import { db } from "@workspace/db";
import { metadataFieldsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/", requireAuth, async (_req, res) => {
  const fields = await db.select().from(metadataFieldsTable).orderBy(metadataFieldsTable.name);
  res.json({ fields });
});

router.post("/", requireAuth, async (req, res) => {
  const { name, label, fieldType, options, required, appliesTo } = req.body;
  if (!name || !label || !fieldType) {
    res.status(400).json({ error: "Bad Request", message: "name, label, fieldType required" });
    return;
  }
  const [field] = await db.insert(metadataFieldsTable).values({
    name, label, fieldType, options: options || [], required: required ?? false, appliesTo: appliesTo || "document",
  }).returning();
  res.status(201).json(field);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(metadataFieldsTable).where(eq(metadataFieldsTable.id, id));
  res.status(204).send();
});

export default router;
