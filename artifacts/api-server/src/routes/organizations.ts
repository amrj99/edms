import { Router } from "express";
import { db } from "@workspace/db";
import { organizationsTable, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const user = req.user!;

  if (isSysAdmin(user)) {
    const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
    const userCounts = await db.select({ orgId: usersTable.organizationId, cnt: count() }).from(usersTable).groupBy(usersTable.organizationId);
    const countMap = new Map(userCounts.map((r) => [r.orgId, Number(r.cnt)]));
    res.json({ organizations: orgs.map((o) => ({ ...o, userCount: countMap.get(o.id) ?? 0 })), total: orgs.length });
    return;
  }

  if (!user.organizationId) {
    res.json({ organizations: [], total: 0 }); return;
  }
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
  if (!org) { res.json({ organizations: [], total: 0 }); return; }
  const [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, org.id));
  res.json({ organizations: [{ ...org, userCount: Number(uc?.cnt ?? 0) }], total: 1 });
});

router.post("/", requireAuth, async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, type, contactEmail, contactPhone, address } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "Bad Request", message: "name and type are required" });
    return;
  }
  const [org] = await db.insert(organizationsTable).values({ name, type, contactEmail, contactPhone, address }).returning();
  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "organization", entityId: org.id, entityTitle: org.name });
  res.status(201).json({ ...org, userCount: 0 });
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!isSysAdmin(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!orgs[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const uc = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, id));
  res.json({ ...orgs[0], userCount: Number(uc[0]?.cnt ?? 0) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!isSysAdmin(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { name, type, contactEmail, contactPhone, address } = req.body;
  const [org] = await db.update(organizationsTable)
    .set({ name, type, contactEmail, contactPhone, address, updatedAt: new Date() })
    .where(eq(organizationsTable.id, id))
    .returning();
  if (!org) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({ userId: req.user!.id, action: "update", entityType: "organization", entityId: org.id, entityTitle: org.name });
  res.json({ ...org, userCount: 0 });
});

router.delete("/:id", requireAuth, async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  res.status(204).send();
});

export default router;
