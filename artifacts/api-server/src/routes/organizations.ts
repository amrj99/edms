import { Router } from "express";
import { db } from "@workspace/db";
import { organizationsTable, usersTable, projectsTable, documentsTable, ncrRecordsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const user = req.user!;

  if (isSysAdmin(user)) {
    const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
    const userCounts = await db.select({ orgId: usersTable.organizationId, cnt: count() }).from(usersTable).groupBy(usersTable.organizationId);
    const projectCounts = await db.select({ orgId: projectsTable.organizationId, cnt: count() }).from(projectsTable).groupBy(projectsTable.organizationId);
    const countMap = new Map(userCounts.map((r) => [r.orgId, Number(r.cnt)]));
    const projMap = new Map(projectCounts.map((r) => [r.orgId, Number(r.cnt)]));
    res.json({
      organizations: orgs.map((o) => ({
        ...o,
        userCount: countMap.get(o.id) ?? 0,
        projectCount: projMap.get(o.id) ?? 0,
      })),
      total: orgs.length,
    });
    return;
  }

  if (!user.organizationId) {
    res.json({ organizations: [], total: 0 }); return;
  }
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
  if (!org) { res.json({ organizations: [], total: 0 }); return; }
  const [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, org.id));
  const [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, org.id));
  res.json({ organizations: [{ ...org, userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) }], total: 1 });
});

// Cross-org stats for system_owner dashboard widget
router.get("/cross-org-stats", requireAuth, async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }

  const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
  const projectRows = await db.select({ id: projectsTable.id, orgId: projectsTable.organizationId }).from(projectsTable);

  // Build project → org mapping
  const projOrgMap = new Map(projectRows.map(p => [p.id, p.orgId]));

  // Count projects per org
  const projCountByOrg = new Map<number, number>();
  projectRows.forEach(p => {
    projCountByOrg.set(p.orgId, (projCountByOrg.get(p.orgId) ?? 0) + 1);
  });

  // Count documents per project, then aggregate by org
  const docCounts = await db.select({ projectId: documentsTable.projectId, cnt: count() }).from(documentsTable).groupBy(documentsTable.projectId);
  const docByOrg = new Map<number, number>();
  docCounts.forEach(r => {
    const orgId = projOrgMap.get(r.projectId);
    if (orgId != null) docByOrg.set(orgId, (docByOrg.get(orgId) ?? 0) + Number(r.cnt));
  });

  // Count open NCRs per project, then aggregate by org
  const ncrCounts = await db
    .select({ projectId: ncrRecordsTable.projectId, cnt: count() })
    .from(ncrRecordsTable)
    .where(eq(ncrRecordsTable.status, "open"))
    .groupBy(ncrRecordsTable.projectId);
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

router.post("/", requireAuth, async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, type, contactEmail, contactPhone, address, code } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "Bad Request", message: "name and type are required" });
    return;
  }
  // Auto-derive a short code from the name if not provided
  const resolvedCode = (code?.trim() || name.replace(/[^A-Za-z0-9]/g, "").substring(0, 6).toUpperCase()) || undefined;
  let org: typeof organizationsTable.$inferSelect;
  try {
    [org] = await db.insert(organizationsTable).values({ name, type, contactEmail, contactPhone, address, code: resolvedCode }).returning();
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint?.includes("code")) {
      res.status(409).json({ error: "Conflict", message: `Organization short code "${resolvedCode}" is already in use. Choose a different code.` });
      return;
    }
    throw err;
  }
  await createAuditLog({ userId: req.user!.id, action: "create", entityType: "organization", entityId: org.id, entityTitle: org.name });
  res.status(201).json({ ...org, userCount: 0, projectCount: 0 });
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!isSysAdmin(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!orgs[0]) { res.status(404).json({ error: "Not Found" }); return; }
  const [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, id));
  const [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, id));
  res.json({ ...orgs[0], userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!isSysAdmin(req.user!) && req.user!.organizationId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { name, type, contactEmail, contactPhone, address, code } = req.body;
  let org: typeof organizationsTable.$inferSelect | undefined;
  try {
    [org] = await db.update(organizationsTable)
      .set({ name, type, contactEmail, contactPhone, address, ...(code !== undefined && { code: code?.trim() || null }), updatedAt: new Date() })
      .where(eq(organizationsTable.id, id))
      .returning();
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint?.includes("code")) {
      res.status(409).json({ error: "Conflict", message: `Organization short code "${code?.trim()}" is already in use by another organization.` });
      return;
    }
    throw err;
  }
  if (!org) { res.status(404).json({ error: "Not Found" }); return; }
  await createAuditLog({ userId: req.user!.id, action: "update", entityType: "organization", entityId: org.id, entityTitle: org.name });
  const [uc] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.organizationId, id));
  const [pc] = await db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.organizationId, id));
  res.json({ ...org, userCount: Number(uc?.cnt ?? 0), projectCount: Number(pc?.cnt ?? 0) });
});

router.delete("/:id", requireAuth, async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  res.status(204).send();
});

export default router;
