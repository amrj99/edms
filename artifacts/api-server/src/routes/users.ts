import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const orgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
  let query = db.select({
    user: usersTable,
    orgName: organizationsTable.name,
  }).from(usersTable).leftJoin(organizationsTable, eq(usersTable.organizationId, organizationsTable.id));

  const results = await query;
  const filtered = orgId ? results.filter(r => r.user.organizationId === orgId) : results;

  res.json({
    users: filtered.map(r => ({
      id: r.user.id,
      email: r.user.email,
      firstName: r.user.firstName,
      lastName: r.user.lastName,
      role: r.user.role,
      organizationId: r.user.organizationId,
      organizationName: r.orgName,
      isActive: r.user.isActive,
      createdAt: r.user.createdAt,
    })),
    total: filtered.length,
  });
});

router.post("/", requireAuth, async (req, res) => {
  const { email, password, firstName, lastName, role, organizationId } = req.body;
  if (!email || !password || !firstName || !lastName || !role) {
    res.status(400).json({ error: "Bad Request", message: "All fields required" });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    firstName,
    lastName,
    role,
    organizationId: organizationId || null,
    isActive: true,
  }).returning();
  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "user", entityId: user.id, entityTitle: `${user.firstName} ${user.lastName}` });
  res.status(201).json({
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    role: user.role, organizationId: user.organizationId, isActive: user.isActive, createdAt: user.createdAt,
  });
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const users = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  const user = users[0];
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  let orgName: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
  }
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId, organizationName: orgName, isActive: user.isActive, createdAt: user.createdAt });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { firstName, lastName, role, isActive } = req.body;
  const [user] = await db.update(usersTable)
    .set({ firstName, lastName, role, isActive, updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId, isActive: user.isActive, createdAt: user.createdAt });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

export default router;
