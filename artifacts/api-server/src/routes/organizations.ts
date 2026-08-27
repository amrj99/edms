import { Router } from "express";
import { db } from "@workspace/db";
import { organizationsTable, usersTable, projectsTable, documentsTable, ncrRecordsTable, orgConfigTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { createAuditLog } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { grantCredits, INITIAL_FREE_CREDITS } from "../lib/ai-credits.js";
import {param, paramInt, requireInt} from '../lib/params';

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  if (isSystemOwner(user)) {
    let orgs: typeof organizationsTable.$inferSelect[] = [];
    let userCounts: { orgId: number | null; cnt: number }[] = [];
    let projectCounts: { orgId: number | null; cnt: number }[] = [];
    await tenantRead(async () => {
      orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
      userCounts = await db.select({ orgId: usersTable.organizationId, cnt: count() }).from(usersTable).groupBy(usersTable.organizationId);
      projectCounts = await db.select({ orgId: projectsTable.organizationId, cnt: count() }).from(projectsTable).groupBy(projectsTable.organizationId);
    });
    const countMap = new Map(userCounts.map((r) => [r.orgId, Number(r.cnt)]));
    const projMap = new Map(projectCounts.map((r) => [r.orgId, Number(r.cnt)]));
    res.json({
      items: orgs.map((o) => ({
        ...o,
        userCount: countMap.get(o.id) ?? 0,
        projectCount: projMap.get(o.id) ?? 0,
      })),
      total: orgs.length,
    });
    return;
  }

  if (!user.organizationId) {
    res.json({ items: [], total: 0 }); return;
  }
  let org: typeof organizationsTable.$inferSelect | undefined;
  let uc: { cnt: number } | undefined;
  let pc: { cnt: number } | undefined;
  await tenantRead(async () => {
    [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId!)).limit(1);
    if (!org) return;
    [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, org.id));
    [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, org.id));
  });
  if (!org) { res.json({ items: [], total: 0 }); return; }
  res.json({ items: [{ ...org, userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) }], total: 1 });
});

// Cross-org stats for system_owner dashboard widget
router.get("/cross-org-stats", requireAuth, async (req, res): Promise<void> => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }

  let orgs: typeof organizationsTable.$inferSelect[] = [];
  let projectRows: { id: number; orgId: number }[] = [];
  let docCounts: { projectId: number; cnt: number }[] = [];
  let ncrCounts: { projectId: number; cnt: number }[] = [];
  await tenantRead(async () => {
    orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
    projectRows = await db.select({ id: projectsTable.id, orgId: projectsTable.organizationId }).from(projectsTable);
    docCounts = await db.select({ projectId: documentsTable.projectId, cnt: count() }).from(documentsTable).groupBy(documentsTable.projectId);
    ncrCounts = await db
      .select({ projectId: ncrRecordsTable.projectId, cnt: count() })
      .from(ncrRecordsTable)
      .where(eq(ncrRecordsTable.status, "open"))
      .groupBy(ncrRecordsTable.projectId);
  });

  // Build project → org mapping
  const projOrgMap = new Map(projectRows.map(p => [p.id, p.orgId]));

  // Count projects per org
  const projCountByOrg = new Map<number, number>();
  projectRows.forEach(p => {
    projCountByOrg.set(p.orgId, (projCountByOrg.get(p.orgId) ?? 0) + 1);
  });

  // Count documents per project, then aggregate by org
  const docByOrg = new Map<number, number>();
  docCounts.forEach(r => {
    const orgId = projOrgMap.get(r.projectId);
    if (orgId != null) docByOrg.set(orgId, (docByOrg.get(orgId) ?? 0) + Number(r.cnt));
  });

  // Count open NCRs per project, then aggregate by org
  const ncrByOrg = new Map<number, number>();
  ncrCounts.forEach(r => {
    const orgId = projOrgMap.get(r.projectId);
    if (orgId != null) ncrByOrg.set(orgId, (ncrByOrg.get(orgId) ?? 0) + Number(r.cnt));
  });

  const stats = orgs.map(o => ({
    id: o.id,
    name: o.name,
    type: o.type,
    projectCount: projCountByOrg.get(o.id) ?? 0,
    documentCount: docByOrg.get(o.id) ?? 0,
    openNcrCount: ncrByOrg.get(o.id) ?? 0,
  }));

  res.json({ stats });
});

router.post("/", requireAuth, async (req, res, next): Promise<void> => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, type, contactEmail, contactPhone, address, code } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "Bad Request", message: "name and type are required" });
    return;
  }
  // Auto-derive a short code from the name if not provided
  const resolvedCode = (code?.trim() || name.replace(/[^A-Za-z0-9]/g, "").substring(0, 6).toUpperCase()) || undefined;

  try {
    // Atomic: create org + audit. (23505 on code → conflict.)
    const outcome = await withTenant(async () => {
      try {
        const [org] = await db.insert(organizationsTable).values({ name, type, contactEmail, contactPhone, address, code: resolvedCode }).returning();
        await createAuditLog({ userId: req.user!.id, action: "create", entityType: "organization", entityId: org.id, entityTitle: org.name });
        return { kind: "ok" as const, org };
      } catch (err: any) {
        if (err?.code === "23505" && err?.constraint?.includes("code")) return { kind: "conflict" as const };
        throw err;
      }
    });
    if (outcome.kind === "conflict") {
      res.status(409).json({ error: "Conflict", message: `Organization short code "${resolvedCode}" is already in use. Choose a different code.` });
      return;
    }
    const { org } = outcome;

    // Best-effort side effects — each in its OWN short tenant transaction so a
    // failure here does not roll back the org creation (matches prior autocommit
    // semantics: "org created; config/credits can be added manually").
    try {
      await withTenant(async () => {
        await db.insert(orgConfigTable).values({
          organizationId: org.id,
          modules: { dashboard: true, deliverables: true, registers: true, notifications: true, chat: true },
        }).onConflictDoNothing();
      });
    } catch (cfgErr) {
      logger.error({ err: cfgErr, orgId: org.id }, "[org-create] Failed to create default org_config — org created but will need manual config setup");
    }

    // Grant initial free AI credits to every new organisation.
    try {
      await withTenant(async () => {
        await grantCredits(org.id, INITIAL_FREE_CREDITS, "grant", { reason: "initial_free_grant" });
      });
    } catch (credErr) {
      logger.error({ err: credErr, orgId: org.id }, "[org-create] Failed to grant initial AI credits — org created, credits can be granted manually");
    }

    res.status(201).json({ ...org, userCount: 0, projectCount: 0 });
  } catch (e) { next(e); }
});

router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  if (!isSystemOwner(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  let orgs: typeof organizationsTable.$inferSelect[] = [];
  let uc: { cnt: number } | undefined;
  let pc: { cnt: number } | undefined;
  await tenantRead(async () => {
    orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
    if (!orgs[0]) return;
    [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, id));
    [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, id));
  });
  if (!orgs[0]) { res.status(404).json({ error: "Not Found" }); return; }
  res.json({ ...orgs[0], userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) });
});

router.put("/:id", requireAuth, async (req, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  if (!isSystemOwner(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { name, type, contactEmail, contactPhone, address, code } = req.body;
  try {
    const outcome = await withTenant(async () => {
      let org: typeof organizationsTable.$inferSelect | undefined;
      try {
        [org] = await db.update(organizationsTable)
          .set({ name, type, contactEmail, contactPhone, address, ...(code !== undefined && { code: code?.trim() || null }), updatedAt: new Date() })
          .where(eq(organizationsTable.id, id))
          .returning();
      } catch (err: any) {
        if (err?.code === "23505" && err?.constraint?.includes("code")) return { kind: "conflict" as const };
        throw err;
      }
      if (!org) return { kind: "notfound" as const };
      await createAuditLog({ userId: req.user!.id, action: "update", entityType: "organization", entityId: org.id, entityTitle: org.name });
      const [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, id));
      const [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, id));
      return { kind: "ok" as const, org, userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) };
    });

    if (outcome.kind === "conflict") {
      res.status(409).json({ error: "Conflict", message: `Organization short code "${code?.trim()}" is already in use by another organization.` });
      return;
    }
    if (outcome.kind === "notfound") { res.status(404).json({ error: "Not Found" }); return; }
    res.json({ ...outcome.org, userCount: outcome.userCount, projectCount: outcome.projectCount });
  } catch (e) { next(e); }
});

router.delete("/:id", requireAuth, async (req, res, next): Promise<void> => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = requireInt(req.params.id);
  try {
    await withTenant(async () => {
      await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
    });
    res.status(204).send();
  } catch (e) { next(e); }
});

export default router;
