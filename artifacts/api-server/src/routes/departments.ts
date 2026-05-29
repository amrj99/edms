import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { departmentsTable, userDepartmentsTable, usersTable } from "@workspace/db";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { requireOrgScope } from "../lib/org-scope.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();

router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrgId(req: any): number | null {
  if (isSysAdmin(req.user) && req.query.orgId) return parseInt(req.query.orgId as string);
  return req.user?.organizationId ?? null;
}

// ─── List departments for org ──────────────────────────────────────────────────
router.get("/", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rows = await db
    .select({
      id:             departmentsTable.id,
      organizationId: departmentsTable.organizationId,
      code:           departmentsTable.code,
      name:           departmentsTable.name,
      description:    departmentsTable.description,
      parentId:       departmentsTable.parentId,
      isActive:       departmentsTable.isActive,
      createdAt:      departmentsTable.createdAt,
      memberCount:    sql<number>`(
        SELECT count(*)::int FROM user_departments ud WHERE ud.department_id = ${departmentsTable.id}
      )`,
    })
    .from(departmentsTable)
    .where(eq(departmentsTable.organizationId, orgId))
    .orderBy(departmentsTable.name);

  res.json(rows);
});

// ─── Create department ─────────────────────────────────────────────────────────
router.post("/", requireMinRole("admin"), async (req, res): Promise<void> => {

  const orgId = getOrgId(req);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const { code, name, description, parentId } = req.body;
  if (!code || !name) { res.status(400).json({ error: "code and name are required" }); return; }

  const [dept] = await db
    .insert(departmentsTable)
    .values({
      organizationId: orgId,
      code: code.trim().toLowerCase(),
      name: name.trim(),
      description: description?.trim() || null,
      parentId: parentId || null,
    })
    .returning();

  res.status(201).json(dept);
});

// ─── Update department ─────────────────────────────────────────────────────────
router.put("/:id", requireMinRole("admin"), async (req, res): Promise<void> => {

  const orgId = getOrgId(req);
  const deptId = paramInt(req.params.id);

  const [existing] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, deptId), eq(departmentsTable.organizationId, orgId!)));

  if (!existing) { res.status(404).json({ error: "Department not found" }); return; }

  const { code, name, description, parentId, isActive } = req.body;

  const [updated] = await db
    .update(departmentsTable)
    .set({
      ...(code !== undefined   && { code: code.trim().toLowerCase() }),
      ...(name !== undefined   && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(parentId !== undefined    && { parentId: parentId || null }),
      ...(isActive !== undefined    && { isActive }),
      updatedAt: new Date(),
    })
    .where(eq(departmentsTable.id, deptId))
    .returning();

  res.json(updated);
});

// ─── Delete department ─────────────────────────────────────────────────────────
router.delete("/:id", requireMinRole("admin"), async (req, res): Promise<void> => {

  const orgId = getOrgId(req);
  const deptId = paramInt(req.params.id);

  const [existing] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, deptId), eq(departmentsTable.organizationId, orgId!)));

  if (!existing) { res.status(404).json({ error: "Department not found" }); return; }

  await db.delete(departmentsTable).where(eq(departmentsTable.id, deptId));
  res.json({ ok: true });
});

// ─── Get members of a department ──────────────────────────────────────────────
router.get("/:id/members", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const deptId = paramInt(req.params.id);

  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, deptId), eq(departmentsTable.organizationId, orgId!)));

  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }

  const members = await db
    .select({
      userId:    usersTable.id,
      firstName: usersTable.firstName,
      lastName:  usersTable.lastName,
      email:     usersTable.email,
      role:      usersTable.role,
      isPrimary: userDepartmentsTable.isPrimary,
      joinedAt:  userDepartmentsTable.joinedAt,
    })
    .from(userDepartmentsTable)
    .innerJoin(usersTable, eq(userDepartmentsTable.userId, usersTable.id))
    .where(eq(userDepartmentsTable.departmentId, deptId))
    .orderBy(usersTable.firstName);

  res.json(members);
});

// ─── Add user to department ────────────────────────────────────────────────────
router.post("/:id/members", requireMinRole("admin"), async (req, res): Promise<void> => {

  const orgId = getOrgId(req);
  const deptId = paramInt(req.params.id);
  const { userId, isPrimary = false } = req.body;

  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, deptId), eq(departmentsTable.organizationId, orgId!)));

  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }

  const [user] = await db
    .select({ id: usersTable.id, orgId: usersTable.organizationId })
    .from(usersTable)
    .where(eq(usersTable.id, parseInt(userId)));

  if (!user || user.orgId !== orgId) {
    res.status(400).json({ error: "User does not belong to this organization" });
    return;
  }

  await db
    .insert(userDepartmentsTable)
    .values({ userId: parseInt(userId), departmentId: deptId, isPrimary })
    .onConflictDoUpdate({
      target: [userDepartmentsTable.userId, userDepartmentsTable.departmentId],
      set: { isPrimary },
    });

  res.status(201).json({ ok: true });
});

// ─── Remove user from department ──────────────────────────────────────────────
router.delete("/:id/members/:userId", requireMinRole("admin"), async (req, res): Promise<void> => {

  const deptId = paramInt(req.params.id);
  const userId = paramInt(req.params.userId);

  await db
    .delete(userDepartmentsTable)
    .where(and(
      eq(userDepartmentsTable.departmentId, deptId),
      eq(userDepartmentsTable.userId, userId),
    ));

  res.json({ ok: true });
});

// ─── Get departments for a specific user ──────────────────────────────────────
router.get("/user/:userId", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const targetUserId = paramInt(req.params.userId);

  const rows = await db
    .select({
      id:          departmentsTable.id,
      code:        departmentsTable.code,
      name:        departmentsTable.name,
      isPrimary:   userDepartmentsTable.isPrimary,
    })
    .from(userDepartmentsTable)
    .innerJoin(departmentsTable, eq(userDepartmentsTable.departmentId, departmentsTable.id))
    .where(and(
      eq(userDepartmentsTable.userId, targetUserId),
      eq(departmentsTable.organizationId, orgId!),
    ))
    .orderBy(userDepartmentsTable.isPrimary);

  res.json(rows);
});

export default router;
