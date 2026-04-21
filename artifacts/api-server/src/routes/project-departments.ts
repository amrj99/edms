import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { projectDepartmentsTable, departmentsTable, projectsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth.js";
import { isSysAdmin } from "../lib/auth.js";

const router = Router({ mergeParams: true });

// ─── Project Departments (Phase B — data layer, no enforcement) ───────────────

// GET  /api/projects/:projectId/departments
// Returns all departments assigned to the project, plus all org departments for UI
router.get("/departments", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const caller = (req as any).user;

  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const orgId = isSysAdmin(caller) ? project.organizationId : (caller.organizationId ?? null);

  const assigned = await db
    .select({
      id:           departmentsTable.id,
      code:         departmentsTable.code,
      name:         departmentsTable.name,
      description:  departmentsTable.description,
      assignedAt:   projectDepartmentsTable.assignedAt,
    })
    .from(projectDepartmentsTable)
    .innerJoin(departmentsTable, eq(departmentsTable.id, projectDepartmentsTable.departmentId))
    .where(eq(projectDepartmentsTable.projectId, projectId));

  res.json(assigned);
});

// POST /api/projects/:projectId/departments  { departmentId }
router.post("/departments", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const { departmentId } = req.body;
  if (!departmentId) { res.status(400).json({ error: "departmentId is required" }); return; }

  // Multi-tenant guard: department must belong to the same org as the project
  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [dept] = await db
    .select({ organizationId: departmentsTable.organizationId })
    .from(departmentsTable)
    .where(eq(departmentsTable.id, parseInt(departmentId)))
    .limit(1);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }

  if (dept.organizationId !== project.organizationId) {
    res.status(403).json({ error: "Department does not belong to this project's organization" }); return;
  }

  const [row] = await db
    .insert(projectDepartmentsTable)
    .values({ projectId, departmentId: parseInt(departmentId) })
    .onConflictDoNothing()
    .returning();

  res.status(201).json(row ?? { ok: true });
});

// DELETE /api/projects/:projectId/departments/:departmentId
router.delete("/departments/:departmentId", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  const departmentId = parseInt(req.params.departmentId);

  await db
    .delete(projectDepartmentsTable)
    .where(and(
      eq(projectDepartmentsTable.projectId, projectId),
      eq(projectDepartmentsTable.departmentId, departmentId),
    ));

  res.json({ ok: true });
});

export default router;
