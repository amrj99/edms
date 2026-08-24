import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { projectDepartmentsTable, departmentsTable, projectsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth.js";
import { isSysAdmin } from "../lib/auth.js";
import { withTenant } from "../middlewares/tenant-scope.js";
import { assertProjectAccess } from "../lib/tenant-guards.js";
import {param, paramInt, requireInt, type ProjectParams} from '../lib/params';

const router = Router({ mergeParams: true });

// ─── Project Departments (Phase B — data layer, no enforcement) ───────────────

// GET  /api/projects/:projectId/departments
// Returns all departments assigned to the project, plus all org departments for UI
router.get("/departments", requireAuth, async (req: Request<ProjectParams>, res): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const caller = (req as any).user;

  if (!(await assertProjectAccess(req, res, projectId, { notFoundOnDeny: true }))) return;

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
router.post("/departments", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const { departmentId } = req.body;
  if (!departmentId) { res.status(400).json({ error: "departmentId is required" }); return; }

  try {
    const outcome = await withTenant(async () => {
      if (!(await assertProjectAccess(req, res, projectId))) return { kind: "handled" as const };

      // Multi-tenant guard: department must belong to the same org as the project
      const [project] = await db
        .select({ organizationId: projectsTable.organizationId })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);
      if (!project) return { kind: "proj-404" as const };

      const [dept] = await db
        .select({ organizationId: departmentsTable.organizationId })
        .from(departmentsTable)
        .where(eq(departmentsTable.id, parseInt(departmentId)))
        .limit(1);
      if (!dept) return { kind: "dept-404" as const };
      if (dept.organizationId !== project.organizationId) return { kind: "cross-org" as const };

      const [row] = await db
        .insert(projectDepartmentsTable)
        .values({ projectId, departmentId: parseInt(departmentId) })
        .onConflictDoNothing()
        .returning();
      return { kind: "ok" as const, row };
    });

    switch (outcome.kind) {
      case "handled": return; // assertProjectAccess already wrote the response
      case "proj-404": res.status(404).json({ error: "Project not found" }); return;
      case "dept-404": res.status(404).json({ error: "Department not found" }); return;
      case "cross-org": res.status(403).json({ error: "Department does not belong to this project's organization" }); return;
      default: res.status(201).json(outcome.row ?? { ok: true }); return;
    }
  } catch (e) { next(e); }
});

// DELETE /api/projects/:projectId/departments/:departmentId
router.delete("/departments/:departmentId", requireAuth, async (req: Request<ProjectParams>, res, next): Promise<void> => {
  const projectId = requireInt(req.params.projectId);
  const departmentId = requireInt(req.params.departmentId);

  try {
    const handled = await withTenant(async () => {
      if (!(await assertProjectAccess(req, res, projectId))) return true; // res already written
      await db
        .delete(projectDepartmentsTable)
        .where(and(
          eq(projectDepartmentsTable.projectId, projectId),
          eq(projectDepartmentsTable.departmentId, departmentId),
        ));
      return false;
    });
    if (handled) return;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
