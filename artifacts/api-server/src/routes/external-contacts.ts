import { Router } from "express";
import { db, externalContactsTable } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const orgId = req.user!.organizationId!;
    const search = (req.query.q as string | undefined)?.trim();

    let rows;
    if (search) {
      rows = await db
        .select()
        .from(externalContactsTable)
        .where(and(
          eq(externalContactsTable.organizationId, orgId),
          or(
            ilike(externalContactsTable.name, `%${search}%`),
            ilike(externalContactsTable.email, `%${search}%`),
            ilike(externalContactsTable.company, `%${search}%`),
          ),
        ))
        .orderBy(externalContactsTable.name);
    } else {
      rows = await db
        .select()
        .from(externalContactsTable)
        .where(eq(externalContactsTable.organizationId, orgId))
        .orderBy(externalContactsTable.name);
    }

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "[external-contacts] GET / error");
    res.status(500).json({ error: "Failed to fetch external contacts" });
  }
});

router.post("/", requireRole("document_controller", "project_manager", "admin", "system_owner"), async (req, res) => {
  try {
    const orgId = req.user!.organizationId!;
    const { name, email, company, jobTitle, phone } = req.body;

    if (!name?.trim() || !email?.trim()) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }

    const [row] = await db
      .insert(externalContactsTable)
      .values({
        organizationId: orgId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        company: company?.trim() || null,
        jobTitle: jobTitle?.trim() || null,
        phone: phone?.trim() || null,
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "[external-contacts] POST / error");
    res.status(500).json({ error: "Failed to create external contact" });
  }
});

router.put("/:id", requireRole("document_controller", "project_manager", "admin", "system_owner"), async (req, res) => {
  try {
    const orgId = req.user!.organizationId!;
    const id = paramInt(req.params.id);
    const { name, email, company, jobTitle, phone } = req.body;

    if (!name?.trim() || !email?.trim()) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }

    const [row] = await db
      .update(externalContactsTable)
      .set({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        company: company?.trim() || null,
        jobTitle: jobTitle?.trim() || null,
        phone: phone?.trim() || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(externalContactsTable.id, id),
        eq(externalContactsTable.organizationId, orgId),
      ))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    logger.error({ err }, "[external-contacts] PUT /:id error");
    res.status(500).json({ error: "Failed to update external contact" });
  }
});

router.delete("/:id", requireRole("admin", "system_owner"), async (req, res) => {
  try {
    const orgId = req.user!.organizationId!;
    const id = paramInt(req.params.id);

    await db
      .delete(externalContactsTable)
      .where(and(
        eq(externalContactsTable.id, id),
        eq(externalContactsTable.organizationId, orgId),
      ));

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "[external-contacts] DELETE /:id error");
    res.status(500).json({ error: "Failed to delete external contact" });
  }
});

export default router;
