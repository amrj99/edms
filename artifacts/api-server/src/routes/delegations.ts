import { Router } from "express";
import { db } from "@workspace/db";
import { delegationsTable, usersTable, projectsTable } from "@workspace/db";
import { eq, and, or, isNull, desc, gt } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { createAuditLog } from "../lib/audit.js";
import {param, paramInt, requireInt} from '../lib/params';

const router = Router();

// ─── List delegations ─────────────────────────────────────────────────────────
// Returns delegations where the caller is either the grantor (fromUser)
// or the delegate (toUser), within their own org.
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const now = new Date();
  const { scope } = req.query; // "active" | "all"

  // system_owner can see all delegations; everyone else (including admin)
  // sees only delegations where they are grantor or delegate within their org.
  const baseWhere = isSystemOwner(caller)
    ? undefined
    : or(
        eq(delegationsTable.fromUserId, caller.id),
        eq(delegationsTable.toUserId, caller.id),
      );

  const rows = await db
    .select({
      delegation: delegationsTable,
      fromUser: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role },
      toUser: { id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role },
    })
    .from(delegationsTable)
    .leftJoin(usersTable, eq(delegationsTable.fromUserId, usersTable.id))
    .where(baseWhere)
    .orderBy(desc(delegationsTable.grantedAt))
    .limit(200);

  // Manually resolve toUser since we can only join once
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const [toUser] = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, r.delegation.toUserId))
        .limit(1);

      let projectName: string | null = null;
      if (r.delegation.projectId) {
        const [proj] = await db
          .select({ name: projectsTable.name })
          .from(projectsTable)
          .where(eq(projectsTable.id, r.delegation.projectId))
          .limit(1);
        projectName = proj?.name ?? null;
      }

      const isExpired = r.delegation.expiresAt < now;
      return {
        ...r.delegation,
        fromUser: r.fromUser,
        toUser: toUser ?? null,
        projectName,
        isExpired,
        isEffectivelyActive: r.delegation.isActive && !isExpired,
      };
    }),
  );

  const result = scope === "active"
    ? enriched.filter(d => d.isEffectivelyActive)
    : enriched;

  res.json({ delegations: result });
});

// ─── Create delegation ────────────────────────────────────────────────────────
// A project manager or admin may delegate their authority to another user.
// projectId is optional — omit for org-wide delegation.
router.post("/", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const caller = req.user!;
  const { toUserId, projectId, reason, expiresAt } = req.body;

  if (!toUserId || !reason?.trim() || !expiresAt) {
    res.status(400).json({ error: "toUserId, reason, and expiresAt are required" }); return;
  }

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime()) || expiry <= new Date()) {
    res.status(400).json({ error: "expiresAt must be a valid future date" }); return;
  }

  if (toUserId === caller.id) {
    res.status(400).json({ error: "You cannot delegate to yourself" }); return;
  }

  // Verify toUser exists and is in the same org (or caller is sysAdmin)
  const [toUser] = await db.select({ id: usersTable.id, organizationId: usersTable.organizationId })
    .from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
  if (!toUser) { res.status(404).json({ error: "Delegate user not found" }); return; }
  if (!isSysAdmin(caller) && toUser.organizationId !== caller.organizationId) {
    res.status(403).json({ error: "Delegate must be in the same organisation" }); return;
  }

  const [delegation] = await db.insert(delegationsTable).values({
    organizationId: caller.organizationId!,
    fromUserId: caller.id,
    toUserId,
    projectId: projectId ?? null,
    reason: reason.trim(),
    expiresAt: expiry,
    isActive: true,
    grantedByUserId: caller.id,
  }).returning();

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "create",
    entityType: "delegation",
    entityId: delegation.id,
    entityTitle: `Delegation from user ${caller.id} to user ${toUserId}`,
    projectId: projectId ?? undefined,
    details: { toUserId, reason: reason.trim(), expiresAt: expiry.toISOString(), projectId },
  });

  res.status(201).json(delegation);
});

// ─── Revoke delegation ────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const id = requireInt(req.params.id);

  const [delegation] = await db.select().from(delegationsTable)
    .where(eq(delegationsTable.id, id)).limit(1);

  if (!delegation) { res.status(404).json({ error: "Delegation not found" }); return; }

  // Only the grantor, grantedBy, or an admin can revoke
  const canRevoke = isSysAdmin(caller)
    || delegation.fromUserId === caller.id
    || delegation.grantedByUserId === caller.id;
  if (!canRevoke) { res.status(403).json({ error: "You do not have permission to revoke this delegation" }); return; }

  await db.update(delegationsTable)
    .set({ isActive: false, revokedAt: new Date(), revokedByUserId: caller.id })
    .where(eq(delegationsTable.id, id));

  await createAuditLog({
    userId: caller.id,
    organizationId: caller.organizationId,
    action: "revoke",
    entityType: "delegation",
    entityId: id,
    entityTitle: `Delegation ${id} revoked`,
    details: { revokedByUserId: caller.id },
  });

  res.status(204).send();
});

export default router;
