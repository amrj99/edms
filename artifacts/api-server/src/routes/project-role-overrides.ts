import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import { projectRoleOverridesTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { assertProjectAccess } from "../lib/tenant-guards.js";
import { createAuditLog } from "../lib/audit.js";
import {param, paramInt, requireInt, type ProjectParams, type ProjectItemParams} from '../lib/params';

const router = Router({ mergeParams: true });

// ─── List project role overrides ──────────────────────────────────────────────
router.get("/role-overrides", requireAuth, requireMinRole("project_manager"), async (req: Request<ProjectParams>, res): Promise<void> => {
  const caller = req.user!;
  const projectId = requireInt(req.params.projectId);
  const now = new Date();

  const result = await tenantRead(async () => {
    if (!(await assertProjectAccess(req, res, projectId))) return { kind: "denied" as const };

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

    return { kind: "ok" as const, enriched };
  });

  if (result.kind === "denied") return;
  res.json({ overrides: result.enriched });
});

// ─── Create project role override ─────────────────────────────────────────────
router.post("/role-overrides", requireAuth, requireMinRole("project_manager"), async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const caller = req.user!;
  const projectId = requireInt(req.params.projectId);
  const { userId, roleOverride, reason, expiresAt } = req.body;

  try {
    const outcome = await withTenant(async () => {
      if (!(await assertProjectAccess(req, res, projectId))) return { kind: "handled" as const };

      if (!userId || !roleOverride || !reason?.trim() || !expiresAt) return { kind: "bad-req" as const };

      const VALID_ROLES = ["system_owner", "admin", "project_manager", "document_controller", "reviewer", "member", "viewer"];
      if (!VALID_ROLES.includes(roleOverride)) return { kind: "bad-role" as const };

      const expiry = new Date(expiresAt);
      if (isNaN(expiry.getTime()) || expiry <= new Date()) return { kind: "bad-expiry" as const };

      // Cannot elevate to system_owner unless you are one
      if (roleOverride === "system_owner" && caller.role !== "system_owner") return { kind: "no-sysowner" as const };

      const [targetUser] = await db.select({ id: usersTable.id, organizationId: usersTable.organizationId })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!targetUser) return { kind: "user-404" as const };
      if (!isSystemOwner(caller) && targetUser.organizationId !== caller.organizationId) return { kind: "cross-org" as const };

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
      return { kind: "ok" as const, override };
    });

    switch (outcome.kind) {
      case "handled": return;
      case "bad-req": res.status(400).json({ error: "userId, roleOverride, reason, and expiresAt are required" }); return;
      case "bad-role": res.status(400).json({ error: "Invalid roleOverride value" }); return;
      case "bad-expiry": res.status(400).json({ error: "expiresAt must be a valid future date" }); return;
      case "no-sysowner": res.status(403).json({ error: "Only system owners can grant system_owner-level overrides" }); return;
      case "user-404": res.status(404).json({ error: "User not found" }); return;
      case "cross-org": res.status(403).json({ error: "User must be in the same organisation" }); return;
      default: res.status(201).json(outcome.override); return;
    }
  } catch (e) { next(e); }
});

// ─── Revoke project role override ─────────────────────────────────────────────
router.delete("/role-overrides/:overrideId", requireAuth, requireMinRole("project_manager"), async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const caller = req.user!;
  const overrideId = requireInt(req.params.overrideId);
  const projectId = requireInt(req.params.projectId);

  try {
    const outcome = await withTenant(async () => {
      if (!(await assertProjectAccess(req, res, projectId))) return { kind: "handled" as const };

      const [override] = await db.select().from(projectRoleOverridesTable)
        .where(and(eq(projectRoleOverridesTable.id, overrideId), eq(projectRoleOverridesTable.projectId, projectId)))
        .limit(1);
      if (!override) return { kind: "notfound" as const };

      const canRevoke = isSysAdmin(caller)
        || override.grantedByUserId === caller.id
        || ["admin", "project_manager"].includes(caller.role);
      if (!canRevoke) return { kind: "forbidden" as const };

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
      return { kind: "ok" as const };
    });

    switch (outcome.kind) {
      case "handled": return;
      case "notfound": res.status(404).json({ error: "Role override not found" }); return;
      case "forbidden": res.status(403).json({ error: "You do not have permission to revoke this override" }); return;
      default: res.status(204).send(); return;
    }
  } catch (e) { next(e); }
});

export default router;
