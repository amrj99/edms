import { Router } from "express";
import { db } from "@workspace/db";
import { packagesTable, usersTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get("/", async (req, res) => {
  const projectId = paramInt(req.params.projectId);
  const packages = await db
    .select({
      id: packagesTable.id,
      name: packagesTable.name,
      code: packagesTable.code,
      description: packagesTable.description,
      projectId: packagesTable.projectId,
      createdAt: packagesTable.createdAt,
      createdByName: usersTable.firstName,
    })
    .from(packagesTable)
    .leftJoin(usersTable, eq(packagesTable.createdById, usersTable.id))
    .where(eq(packagesTable.projectId, projectId))
    .orderBy(packagesTable.createdAt);
  res.json(packages);
});

router.post("/", async (req, res) => {
  const projectId = paramInt(req.params.projectId);
  const { name, code, description } = req.body;
  if (!name || !code) {
    res.status(400).json({ error: "Name and code are required" });
    return;
  }
  const [pkg] = await db.insert(packagesTable).values({
    name,
    code: code.toUpperCase(),
    description,
    projectId,
    createdById: req.user!.id,
  }).returning();
  res.status(201).json(pkg);
});

router.put("/:id", async (req, res) => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const user = req.user!;
  const { name, code, description } = req.body;

  // Tenant isolation: verify package belongs to the project in the URL,
  // and that project belongs to the user's org.
  if (!isSysAdmin(user) && user.organizationId) {
    const [project] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!project || project.organizationId !== user.organizationId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const [pkg] = await db.update(packagesTable)
    .set({ name, code: code?.toUpperCase(), description, updatedAt: new Date() })
    .where(and(eq(packagesTable.id, id), eq(packagesTable.projectId, projectId)))
    .returning();
  if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
  res.json(pkg);
});

router.delete("/:id", async (req, res) => {
  const id = paramInt(req.params.id);
  const projectId = paramInt(req.params.projectId);
  const user = req.user!;

  // Tenant isolation: verify project belongs to the user's org before deleting.
  if (!isSysAdmin(user) && user.organizationId) {
    const [project] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    if (!project || project.organizationId !== user.organizationId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  await db.delete(packagesTable).where(and(eq(packagesTable.id, id), eq(packagesTable.projectId, projectId)));
  res.json({ success: true });
});

export default router;
