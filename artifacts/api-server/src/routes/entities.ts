import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { entitiesTable, contactsTable } from "@workspace/db";
import { requireAuth, isSystemOwner } from "../lib/auth.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { parseBody } from "../lib/validate.js";
import { requireInt } from "../lib/params.js";
import { z } from "zod";

const router = Router();

router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrgId(req: any): number | null {
  // DEBT-009: only system_owner may target another org via ?orgId (was isSysAdmin →
  // tenant-admin cross-org IDOR on entities + contacts).
  if (isSystemOwner(req.user) && req.query.orgId) return parseInt(req.query.orgId as string, 10) || null;
  return req.user?.organizationId ?? null;
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const ENTITY_TYPES = ["company", "government", "individual", "ngo", "consortium"] as const;

const createEntitySchema = z.object({
  name:               z.string().min(1).max(255),
  type:               z.enum(ENTITY_TYPES),
  country:            z.string().max(2).optional(),
  registrationNumber: z.string().max(100).optional(),
  parentEntityId:     z.number().int().positive().optional(),
});

const updateEntitySchema = createEntitySchema.partial();

const createContactSchema = z.object({
  name:     z.string().min(1).max(255),
  email:    z.string().email().optional(),
  phone:    z.string().max(50).optional(),
  jobTitle: z.string().max(255).optional(),
  userId:   z.number().int().positive().optional(),
});

const updateContactSchema = createContactSchema.partial();

// ─── Entities: List ───────────────────────────────────────────────────────────

router.get("/", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  let rows: typeof entitiesTable.$inferSelect[] | undefined;
  await tenantRead(async () => {
    rows = await db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.organizationId, orgId))
      .orderBy(entitiesTable.name);
  });

  res.json(rows);
});

// ─── Entities: Get single ─────────────────────────────────────────────────────

router.get("/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);

  let entity: typeof entitiesTable.$inferSelect | undefined;
  await tenantRead(async () => {
    [entity] = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));
  });

  if (!entity) { res.status(404).json({ error: "Entity not found" }); return; }
  res.json(entity);
});

// ─── Entities: Create ─────────────────────────────────────────────────────────

router.post("/", requireMinRole("admin"), parseBody(createEntitySchema), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const { name, type, country, registrationNumber, parentEntityId } = req.body as z.infer<typeof createEntitySchema>;

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    if (parentEntityId) {
      const [parent] = await db
        .select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(and(eq(entitiesTable.id, parentEntityId), eq(entitiesTable.organizationId, orgId)));
      if (!parent) { result = { status: 400, body: { error: "Parent entity not found in this organization" } }; return; }
    }

    const [entity] = await db
      .insert(entitiesTable)
      .values({
        organizationId:     orgId,
        name:               name.trim(),
        type,
        country:            country?.toUpperCase() || null,
        registrationNumber: registrationNumber?.trim() || null,
        parentEntityId:     parentEntityId || null,
      })
      .returning();
    result = { status: 201, body: entity };
  });
  res.status(result!.status).json(result!.body);
});

// ─── Entities: Update ─────────────────────────────────────────────────────────

router.put("/:id", requireMinRole("admin"), parseBody(updateEntitySchema), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [existing] = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!existing) { result = { status: 404, body: { error: "Entity not found" } }; return; }

    const { name, type, country, registrationNumber, parentEntityId } = req.body as z.infer<typeof updateEntitySchema>;

    if (parentEntityId !== undefined && parentEntityId !== null) {
      if (parentEntityId === entityId) { result = { status: 400, body: { error: "Entity cannot be its own parent" } }; return; }
      const [parent] = await db
        .select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(and(eq(entitiesTable.id, parentEntityId), eq(entitiesTable.organizationId, orgId!)));
      if (!parent) { result = { status: 400, body: { error: "Parent entity not found in this organization" } }; return; }
    }

    const [updated] = await db
      .update(entitiesTable)
      .set({
        ...(name               !== undefined && { name: name.trim() }),
        ...(type               !== undefined && { type }),
        ...(country            !== undefined && { country: country?.toUpperCase() || null }),
        ...(registrationNumber !== undefined && { registrationNumber: registrationNumber?.trim() || null }),
        ...(parentEntityId     !== undefined && { parentEntityId: parentEntityId || null }),
        updatedAt: new Date(),
      })
      .where(eq(entitiesTable.id, entityId))
      .returning();
    result = { status: 200, body: updated };
  });
  res.status(result!.status).json(result!.body);
});

// ─── Entities: Delete ─────────────────────────────────────────────────────────

router.delete("/:id", requireMinRole("admin"), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [existing] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!existing) { result = { status: 404, body: { error: "Entity not found" } }; return; }

    await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
    result = { status: 200, body: { ok: true } };
  });
  res.status(result!.status).json(result!.body);
});

// ─── Contacts: List ───────────────────────────────────────────────────────────

router.get("/:id/contacts", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);

  let entity: { id: number } | undefined;
  let contacts: typeof contactsTable.$inferSelect[] | undefined;
  await tenantRead(async () => {
    [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!entity) return;

    contacts = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.entityId, entityId))
      .orderBy(contactsTable.name);
  });

  if (!entity) { res.status(404).json({ error: "Entity not found" }); return; }

  res.json(contacts);
});

// ─── Contacts: Create ─────────────────────────────────────────────────────────

router.post("/:id/contacts", requireMinRole("admin"), parseBody(createContactSchema), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);

  const { name, email, phone, jobTitle, userId } = req.body as z.infer<typeof createContactSchema>;

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!entity) { result = { status: 404, body: { error: "Entity not found" } }; return; }

    const [contact] = await db
      .insert(contactsTable)
      .values({
        entityId,
        name:     name.trim(),
        email:    email?.trim() || null,
        phone:    phone?.trim() || null,
        jobTitle: jobTitle?.trim() || null,
        userId:   userId || null,
      })
      .returning();
    result = { status: 201, body: contact };
  });
  res.status(result!.status).json(result!.body);
});

// ─── Contacts: Update ─────────────────────────────────────────────────────────

router.put("/:id/contacts/:cid", requireMinRole("admin"), parseBody(updateContactSchema), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);
  const contactId = requireInt(req.params.cid);

  const { name, email, phone, jobTitle, userId } = req.body as z.infer<typeof updateContactSchema>;

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!entity) { result = { status: 404, body: { error: "Entity not found" } }; return; }

    const [existing] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.entityId, entityId)));

    if (!existing) { result = { status: 404, body: { error: "Contact not found" } }; return; }

    const [updated] = await db
      .update(contactsTable)
      .set({
        ...(name     !== undefined && { name: name.trim() }),
        ...(email    !== undefined && { email: email?.trim() || null }),
        ...(phone    !== undefined && { phone: phone?.trim() || null }),
        ...(jobTitle !== undefined && { jobTitle: jobTitle?.trim() || null }),
        ...(userId   !== undefined && { userId: userId || null }),
        updatedAt: new Date(),
      })
      .where(eq(contactsTable.id, contactId))
      .returning();
    result = { status: 200, body: updated };
  });
  res.status(result!.status).json(result!.body);
});

// ─── Contacts: Delete ─────────────────────────────────────────────────────────

router.delete("/:id/contacts/:cid", requireMinRole("admin"), async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const entityId = requireInt(req.params.id);
  const contactId = requireInt(req.params.cid);

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.organizationId, orgId!)));

    if (!entity) { result = { status: 404, body: { error: "Entity not found" } }; return; }

    const [existing] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.entityId, entityId)));

    if (!existing) { result = { status: 404, body: { error: "Contact not found" } }; return; }

    await db.delete(contactsTable).where(eq(contactsTable.id, contactId));
    result = { status: 200, body: { ok: true } };
  });
  res.status(result!.status).json(result!.body);
});

export default router;
