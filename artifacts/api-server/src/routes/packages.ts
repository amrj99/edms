import { Router } from "express";
import { db } from "@workspace/db";
import { packagesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get("/", async (req, res) => {
  const projectId = parseInt(req.params.projectId);
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
  const projectId = parseInt(req.params.projectId);
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
  const id = parseInt(req.params.id);
  const { name, code, description } = req.body;
  const [pkg] = await db.update(packagesTable)
    .set({ name, code: code?.toUpperCase(), description, updatedAt: new Date() })
    .where(eq(packagesTable.id, id))
    .returning();
  if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
  res.json(pkg);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(packagesTable).where(eq(packagesTable.id, id));
  res.json({ success: true });
});

export default router;
