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
    passwordHash: await hashPassword(password),
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
  const { firstName, lastName, role, isActive, organizationId, department } = req.body;
  const updateSet: Record<string, any> = { updatedAt: new Date() };
  if (firstName !== undefined) updateSet.firstName = firstName;
  if (lastName !== undefined) updateSet.lastName = lastName;
  if (role !== undefined) updateSet.role = role;
  if (isActive !== undefined) updateSet.isActive = isActive;
  if ("organizationId" in req.body) updateSet.organizationId = organizationId ?? null;
  if (department !== undefined) updateSet.department = department || null;
  const [user] = await db.update(usersTable)
    .set(updateSet)
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({ userId: req.user!.id, action: "update", entityType: "user", entityId: id, entityTitle: `${user.firstName} ${user.lastName}` });
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId, department: user.department, isActive: user.isActive, createdAt: user.createdAt });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

router.post("/:id/reset-password", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [user] = await db.update(usersTable)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({ userId: req.user!.id, action: "reset_password", entityType: "user", entityId: id, entityTitle: `${user.firstName} ${user.lastName}` });
  res.json({ message: "Password reset successfully" });
});

export default router;
