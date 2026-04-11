import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth, hashPassword, isSysAdmin } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { PLANS } from "../lib/plans.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  // sysAdmin may pass an explicit orgId filter; all other roles are locked to their own org
  const requestedOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
  const orgId = isSysAdmin(req.user!)
    ? requestedOrgId
    : req.user!.organizationId ?? undefined;

  const results = await db.select({
    user: usersTable,
    orgName: organizationsTable.name,
  }).from(usersTable).leftJoin(organizationsTable, eq(usersTable.organizationId, organizationsTable.id));

  const filtered = orgId !== undefined ? results.filter(r => r.user.organizationId === orgId) : results;

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

  // Enforce per-plan user limit
  const targetOrgId = organizationId ? parseInt(String(organizationId)) : req.user!.organizationId;
  if (targetOrgId) {
    const [org] = await db
      .select({ subscriptionTier: organizationsTable.subscriptionTier })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, targetOrgId));

    const plan = PLANS.find(p => p.id === (org?.subscriptionTier ?? "free"));
    if (plan && plan.maxUsers !== null) {
      const [uc] = await db
        .select({ cnt: count() })
        .from(usersTable)
        .where(and(eq(usersTable.organizationId, targetOrgId), eq(usersTable.isActive, true)));
      const currentCount = Number(uc?.cnt ?? 0);
      if (currentCount >= plan.maxUsers) {
        res.status(403).json({
          error: "USER_LIMIT_REACHED",
          message: `Your ${plan.name} plan allows up to ${plan.maxUsers} users. Please upgrade to add more.`,
        });
        return;
      }
    }
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
  const caller = req.user!;

  const users = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  const user = users[0];
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }

  // sysAdmins can fetch any user; others can only fetch users within their own org
  if (!isSysAdmin(caller) && caller.id !== id && user.organizationId !== caller.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  let orgName: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
  }
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId, organizationName: orgName, isActive: user.isActive, createdAt: user.createdAt });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = req.user!;
  const isSelf = caller.id === id;

  // sysAdmins can edit any user; regular users can only edit themselves
  if (!isSysAdmin(caller) && !isSelf) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // Non-admins cannot change privileged fields on their own profile
  if (!isSysAdmin(caller) && isSelf) {
    const forbidden = ["role", "isActive", "organizationId"];
    if (forbidden.some(f => f in req.body)) {
      res.status(403).json({ error: "Forbidden", message: "Cannot change role, organization, or activation status" }); return;
    }
  }

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
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

router.post("/:id/reset-password", requireAuth, async (req, res) => {
  const caller = req.user!;
  const id = parseInt(req.params.id);
  // Only sysAdmins can reset other users' passwords; users may reset their own
  if (!isSysAdmin(caller) && caller.id !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
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
