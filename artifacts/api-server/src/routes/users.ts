import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable, projectMembersTable, projectsTable } from "@workspace/db";
import { eq, count, and, inArray, isNotNull } from "drizzle-orm";
import { requireAuth, hashPassword, isSysAdmin, isSystemOwner, generateSecureToken, hashToken } from "../lib/auth.js";
import { validatePasswordPolicy } from "../lib/security-settings.js";
import { requireMinRole, requireAdminOrSelf } from "../middlewares/require-role.js";
import { createAuditLog } from "../lib/audit.js";
import { PLANS } from "../lib/plans.js";
import { getOrgPlan } from "../lib/plan-service.js";
import { sendOnboardingEmail, APP_URL } from "../lib/email.js";
import { passwordResetTokensTable } from "@workspace/db";
import {param, paramInt, requireInt, queryIntOrNull} from '../lib/params';

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const requestedOrgId = queryIntOrNull(req.query.organizationId) ?? undefined;
  const requestedProjectId = queryIntOrNull(req.query.projectId) ?? undefined;

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

  // Tenant isolation: filter at DB level — never in-memory.
  // Non-sysOwner users without an org get an empty result (fail-safe).
  if (!isSystemOwner(caller) && orgId === undefined) {
    res.json({ users: [], total: 0 }); return;
  }

  const orgFilter = orgId !== undefined
    ? eq(usersTable.organizationId, orgId)
    : isNotNull(usersTable.organizationId); // sysOwner with no filter → all orgs

  const results = await db.select({
    user: usersTable,
    orgName: organizationsTable.name,
  }).from(usersTable)
    .leftJoin(organizationsTable, eq(usersTable.organizationId, organizationsTable.id))
    .where(orgFilter);

  res.json({
    users: results.map(r => ({
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
    total: results.length,
  });
});

// ── P0 security fix: requireMinRole("admin") enforces that only admin+ may
// create users. Without this gate any authenticated user (viewer, member, etc.)
// could POST to this endpoint and create accounts with elevated roles — a
// direct privilege escalation path.
router.post("/", requireAuth, requireMinRole("admin"), async (req, res): Promise<void> => {
  const caller = req.user!;

  // ── Onboarding flow: password is not required from admin.
  // A secure onboarding token is generated and emailed to the user.
  const { email, firstName, lastName, role, organizationId } = req.body;
  if (!email || !firstName || !lastName || !role) {
    res.status(400).json({ error: "Bad Request", message: "email, firstName, lastName and role are required" });
    return;
  }

  // ── Role assignment guard ──────────────────────────────────────────────────
  const ORG_ASSIGNABLE_ROLES = ["admin", "project_manager", "document_controller", "reviewer", "member", "viewer"];
  if (!ORG_ASSIGNABLE_ROLES.includes(role)) {
    res.status(400).json({ error: "Bad Request", message: `Role "${role}" is not assignable via this endpoint.` });
    return;
  }

  // Enforce per-plan user limit.
  const targetOrgId = organizationId ? parseInt(String(organizationId)) : caller.organizationId;
  if (targetOrgId && !isSystemOwner(caller)) {
    const planId = await getOrgPlan(targetOrgId);
    const plan = PLANS.find(p => p.id === planId);
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

  // Only system_owner may create users in a different organization.
  const resolvedOrgId = isSystemOwner(caller)
    ? (organizationId ? parseInt(String(organizationId)) : null)
    : (caller.organizationId ?? null);

  // Create user with a random temporary password hash (never exposed).
  // The real password is set by the user via the onboarding link.
  const tempPassword = generateSecureToken(); // random, never sent to anyone
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash: await hashPassword(tempPassword),
    firstName,
    lastName,
    role,
    organizationId: resolvedOrgId,
    isActive: true,
    mustChangePassword: true,
  }).returning();

  // Generate onboarding token (48h TTL) — reuses password_reset_tokens table.
  const onboardingToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    organizationId: resolvedOrgId,
    token: hashToken(onboardingToken),
    expiresAt,
  });

  // Resolve org name for email
  let orgName = "ArcScale EDMS";
  if (resolvedOrgId) {
    const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, resolvedOrgId)).limit(1);
    if (org) orgName = org.name;
  }

  // Send onboarding email — fire and forget
  const setPasswordUrl = `${APP_URL}/set-password?token=${onboardingToken}`;
  sendOnboardingEmail({ to: user.email, firstName: user.firstName, organizationName: orgName, setPasswordUrl }).catch(() => {});

  await createAuditLog({
    userId: caller.id,
    organizationId: resolvedOrgId ?? undefined,
    action: "create",
    entityType: "user",
    entityId: user.id,
    entityTitle: `${user.firstName} ${user.lastName}`,
    details: { role: user.role, createdByRole: caller.role, onboardingEmailSent: true },
  });
  res.status(201).json({
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    role: user.role, organizationId: user.organizationId, isActive: user.isActive,
    mustChangePassword: user.mustChangePassword, createdAt: user.createdAt,
  });
});

router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
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

router.put("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const isSelf = caller.id === id;

  // sysAdmins can edit any user; regular users can only edit themselves
  if (!isSysAdmin(caller) && !isSelf) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // ── P1 security fix: org boundary for PUT ──────────────────────────────────
  // Without this check an org admin could modify any user in any org — changing
  // their role, disabling their account, or updating their profile. Verified
  // exploitable in T13 live testing: admin (org1) → PUT user (org2) → 200.
  // system_owner spans all orgs by design; org admins must stay within their org.
  if (isSysAdmin(caller) && !isSystemOwner(caller) && !isSelf) {
    const [target] = await db.select({ organizationId: usersTable.organizationId })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target) { res.status(404).json({ error: "Not Found" }); return; }
    if (target.organizationId !== caller.organizationId) {
      res.status(403).json({ error: "Forbidden", message: "Cross-organization modification denied." });
      return;
    }
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
  if ("organizationId" in req.body) {
    // Only system_owner may move a user to a different organization.
    if (!isSystemOwner(caller)) {
      res.status(403).json({ error: "Forbidden", message: "Only a system owner may change a user's organization" });
      return;
    }
    updateSet.organizationId = organizationId ?? null;
  }
  if (department !== undefined) updateSet.department = department || null;

  const changedFields = Object.keys(updateSet).filter(k => k !== "updatedAt");
  const [user] = await db.update(usersTable)
    .set(updateSet)
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId ?? undefined,
    action: "update",
    entityType: "user",
    entityId: id,
    entityTitle: `${user.firstName} ${user.lastName}`,
    details: { callerRole: caller.role, changedFields },
  });
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizationId: user.organizationId, department: user.department, isActive: user.isActive, createdAt: user.createdAt });
});

router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;

  // ── Role guard ─────────────────────────────────────────────────────────────
  if (!isSysAdmin(caller)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const id = requireInt(req.params.id);

  // Prevent self-deletion — an admin deleting their own account could leave an
  // org with no admin, and the action cannot be undone.
  if (caller.id === id) {
    res.status(400).json({ error: "Bad Request", message: "You cannot delete your own account." });
    return;
  }

  // Fetch the target user before acting on it.
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  // ── system_owner protection (check BEFORE org boundary) ───────────────────
  // system_owner accounts have no organizationId (null). If the org boundary
  // check ran first, it would fire with a misleading "cross-organization"
  // message because null !== caller.organizationId. Check role first so the
  // correct, accurate message is returned.
  if (target.role === "system_owner") {
    res.status(403).json({ error: "Forbidden", message: "System owner accounts cannot be deleted via the API." });
    return;
  }

  // ── Org boundary check ─────────────────────────────────────────────────────
  // system_owner spans all orgs by design; org admins must stay within their org.
  if (!isSystemOwner(caller) && target.organizationId !== caller.organizationId) {
    res.status(403).json({ error: "Forbidden", message: "Cross-organization deletion denied." });
    return;
  }

  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  } catch (err: any) {
    // FK violations occur when the user has project memberships, tasks, or
    // other related records. Hard deletion requires clearing those first.
    // Return 409 so the caller understands why (rather than a 500).
    //
    // Drizzle-orm wraps the underlying pg error — the PostgreSQL error code
    // (23503 = foreign_key_violation) may be on err.code, err.cause.code, or
    // somewhere in the stringified error. Check all three to be safe.
    const errStr = String(err?.message ?? "") + String(err?.stack ?? "");
    const isFkViolation =
      err?.code === "23503" ||
      err?.cause?.code === "23503" ||
      errStr.includes("23503") ||
      errStr.toLowerCase().includes("foreign key");

    if (isFkViolation) {
      res.status(409).json({
        error: "Conflict",
        message: "This user has related records (project memberships, tasks, etc.) and cannot be hard-deleted. Deactivate the account instead: PUT /:id with { isActive: false }.",
      });
      return;
    }
    throw err;
  }

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId ?? undefined,
    action: "delete",
    entityType: "user",
    entityId: id,
    entityTitle: `${target.firstName} ${target.lastName}`,
    details: { deletedUserRole: target.role, deletedUserOrg: target.organizationId, deletedByRole: caller.role },
  });

  res.status(204).send();
});

router.post("/:id/reset-password", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const id = requireInt(req.params.id);
  const isSelf = caller.id === id;

  // Only sysAdmins can reset other users' passwords; users may reset their own
  if (!isSysAdmin(caller) && !isSelf) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // ── P1 security fix: org boundary for reset-password ─────────────────────
  // Without this check an org admin could reset any user's password across orgs
  // — a direct account takeover path. Verified exploitable in T12 live testing:
  // admin (org1) → POST /users/5/reset-password (org2) → 200, password changed.
  // system_owner spans all orgs by design; org admins must stay within their org.
  if (isSysAdmin(caller) && !isSystemOwner(caller) && !isSelf) {
    const [target] = await db.select({ organizationId: usersTable.organizationId })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target) { res.status(404).json({ error: "Not Found" }); return; }
    if (target.organizationId !== caller.organizationId) {
      res.status(403).json({ error: "Forbidden", message: "Cross-organization password reset denied." });
      return;
    }
  }

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const now = new Date();
  const [user] = await db.update(usersTable)
    .set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: now, mustChangePassword: false, updatedAt: now })
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId ?? undefined,
    action: "reset_password",
    entityType: "user",
    entityId: id,
    entityTitle: `${user.firstName} ${user.lastName}`,
    details: { callerRole: caller.role, isSelf },
  });
  res.json({ message: "Password reset successfully" });
});

export default router;
