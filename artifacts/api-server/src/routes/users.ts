import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable, projectMembersTable, projectsTable } from "@workspace/db";
import { eq, count, and, inArray } from "drizzle-orm";
import { requireAuth, hashPassword, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { PLANS } from "../lib/plans.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const caller = req.user!;
  const requestedOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
  const requestedProjectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;

  // ── Project-scoped query: all members of a project (cross-org collaboration) ──
  if (requestedProjectId) {
    // Caller must be a member of the requested project (or sysAdmin)
    if (!isSysAdmin(caller)) {
      const [selfMembership] = await db.select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, requestedProjectId), eq(projectMembersTable.userId, caller.id)))
        .limit(1);
      if (!selfMembership) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    const members = await db.select({ userId: projectMembersTable.userId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.projectId, requestedProjectId));
    const memberIds = members.map(m => m.userId);
    if (memberIds.length === 0) { res.json({ users: [], total: 0 }); return; }

    const results = await db.select({ user: usersTable, orgName: organizationsTable.name })
      .from(usersTable)
      .leftJoin(organizationsTable, eq(usersTable.organizationId, organizationsTable.id))
      .where(inArray(usersTable.id, memberIds));

    res.json({
      users: results.map(r => ({
        id: r.user.id,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        email: r.user.email,
        role: r.user.role,
        organizationId: r.user.organizationId,
        organizationName: r.orgName,
        isActive: r.user.isActive,
      })),
      total: results.length,
    });
    return;
  }

  // ── Standard org-scoped query ────────────────────────────────────────────────
  // Only system_owner may query across orgs via ?organizationId=. Org admins
  // are always scoped to their own organization.
  const orgId = isSystemOwner(caller)
    ? requestedOrgId
    : caller.organizationId ?? undefined;

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

  let limitedProfile = false;

  if (!isSysAdmin(caller) && caller.id !== id && user.organizationId !== caller.organizationId) {
    // Cross-org: only allowed if they share at least one project membership
    const callerProjectIds = (await db.select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, caller.id))
    ).map(r => r.projectId);

    const hasSharedProject = callerProjectIds.length > 0
      && (await db.select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.userId, id), inArray(projectMembersTable.projectId, callerProjectIds)))
        .limit(1)).length > 0;

    if (!hasSharedProject) { res.status(403).json({ error: "Forbidden" }); return; }
    limitedProfile = true; // Only expose collaboration-level fields
  }

  let orgName: string | undefined;
  let orgType: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
    orgType = orgs[0]?.type;
  }

  if (limitedProfile) {
    // Limited cross-org profile: name, email, organisation, role — no internal/admin fields
    res.json({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, organizationId: user.organizationId, organizationName: orgName });
    return;
  }

  // Full profile: include project memberships
  const projectMemberships = await db
    .select({
      projectId: projectMembersTable.projectId,
      projectName: projectsTable.name,
      projectCode: projectsTable.code,
      memberRole: projectMembersTable.role,
    })
    .from(projectMembersTable)
    .leftJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(eq(projectMembersTable.userId, id));

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: orgName,
    organizationType: orgType,
    isActive: user.isActive,
    createdAt: user.createdAt,
    department: user.department,
    projectMemberships: projectMemberships.map(m => ({
      projectId: m.projectId,
      projectName: m.projectName,
      projectCode: m.projectCode,
      role: m.memberRole,
    })),
  });
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
