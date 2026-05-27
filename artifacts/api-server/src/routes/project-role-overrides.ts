import { Router } from "express";
import { db } from "@workspace/db";
import { projectRoleOverridesTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router({ mergeParams: true });

// ─── List project role overrides ──────────────────────────────────────────────
router.get("/role-overrides", requireAuth, async (req, res) => {
  const caller = req.user!;
  const projectId = paramInt(req.params.projectId);
  const now = new Date();

  // Must be PM or admin on this project (or sysAdmin)
  if (!isSysAdmin(caller) && !["admin", "project_manager"].includes(caller.role)) {
    res.status(403).json({ error: "Only project managers and admins can view role overrides" }); return;
  }

  const rows = await db
    .select({
      override: projectRoleOverridesTable,
    })
    .from(projectRoleOverridesTable)
    .where(eq(projectRoleOverridesTable.projectId, projectId))
    .orderBy(desc(projectRoleOverridesTable.grantedAt))
    .limit(200);

  const enriched = await Promise.all(
    rows.map(async (r) => {
      const [user] = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, r.override.userId))
        .limit(1);
      const [grantedBy] = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(eq(usersTable.id, r.override.grantedByUserId))
        .limit(1);

      const isExpired = r.override.expiresAt < now;
      return {
        ...r.override,
        user: user ?? null,
        grantedBy: grantedBy ?? null,
        isExpired,
        isEffectivelyActive: r.override.isActive && !isExpired,
      };
    }),
  );

  res.json({ overrides: enriched });
});

// ─── Create project role override ─────────────────────────────────────────────
router.post("/role-overrides", requireAuth, async (req, res) => {
  const caller = req.user!;
  const projectId = paramInt(req.params.projectId);
  const { userId, roleOverride, reason, expiresAt } = req.body;

  if (!userId || !roleOverride || !reason?.trim() || !expiresAt) {
    res.status(400).json({ error: "userId, roleOverride, reason, and expiresAt are required" }); return;
  }

  // Only PM+ can create overrides
  if (!isSysAdmin(caller) && !["admin", "project_manager"].includes(caller.role)) {
    res.status(403).json({ error: "Only project managers and admins can create role overrides" }); return;
  }

  const VALID_ROLES = ["system_owner", "admin", "project_manager", "document_controller", "reviewer", "member", "viewer"];
  if (!VALID_ROLES.includes(roleOverride)) {
    res.status(400).json({ error: "Invalid roleOverride value" }); return;
  }

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime()) || expiry <= new Date()) {
    res.status(400).json({ error: "expiresAt must be a valid future date" }); return;
  }

  // Cannot elevate to system_owner unless you are one
  if (roleOverride === "system_owner" && caller.role !== "system_owner") {
    res.status(403).json({ error: "Only system owners can grant system_owner-level overrides" }); return;
  }

  const [targetUser] = await db.select({ id: usersTable.id, organizationId: usersTable.organizationId })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }
  if (!isSysAdmin(caller) && targetUser.organizationId !== caller.organizationId) {
    res.status(403).json({ error: "User must be in the same organisation" }); return;
  }

  const [override] = await db.insert(projectRoleOverridesTable).values({
    organizationId: caller.organizationId!,
    projectId,
    userId,
    roleOverride: roleOverride as any,
    reason: reason.trim(),
    expiresAt: expiry,
    isActive: true,
    grantedByUserId: caller.id,
  }).returning();

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "create",
    entityType: "project_role_override",
    entityId: override.id,
    entityTitle: `Role override: user ${userId} elevated to ${roleOverride} on project ${projectId}`,
    projectId,
    details: { userId, roleOverride, reason: reason.trim(), expiresAt: expiry.toISOString() },
  });

  res.status(201).json(override);
});

// ─── Revoke project role override ─────────────────────────────────────────────
router.delete("/role-overrides/:overrideId", requireAuth, async (req, res) => {
  const caller = req.user!;
  const overrideId = paramInt(req.params.overrideId);
  const projectId = paramInt(req.params.projectId);

  const [override] = await db.select().from(projectRoleOverridesTable)
    .where(and(eq(projectRoleOverridesTable.id, overrideId), eq(projectRoleOverridesTable.projectId, projectId)))
    .limit(1);

  if (!override) { res.status(404).json({ error: "Role override not found" }); return; }

  const canRevoke = isSysAdmin(caller)
    || override.grantedByUserId === caller.id
    || ["admin", "project_manager"].includes(caller.role);
  if (!canRevoke) { res.status(403).json({ error: "You do not have permission to revoke this override" }); return; }

  await db.update(projectRoleOverridesTable)
    .set({ isActive: false, revokedAt: new Date(), revokedByUserId: caller.id })
    .where(eq(projectRoleOverridesTable.id, overrideId));

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "revoke",
    entityType: "project_role_override",
    entityId: overrideId,
    entityTitle: `Role override ${overrideId} revoked`,
    projectId,
    details: { revokedByUserId: caller.id },
  });

  res.status(204).send();
});

export default router;
