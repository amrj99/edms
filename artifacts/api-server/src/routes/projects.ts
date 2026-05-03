import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, organizationsTable, usersTable, documentsTable } from "@workspace/db";
import { eq, count, and, inArray } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { PLANS } from "../lib/plans.js";

const router = Router();

// ─── Validation constants (derived from DB schema) ────────────────────────────
// status is a pgEnum — values must match exactly
const VALID_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;
type ProjectStatus = typeof VALID_STATUSES[number];

// code: alphanumeric, hyphens, underscores — consistent with engineering project codes
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

// ─── Helper: map DB error codes to user-friendly field errors ─────────────────
function pgErrCode(err: unknown): string | undefined {
  return (err as any)?.code ?? (err as any)?.cause?.code;
}

// ─── Roles that can see all org projects without membership check ──────────────
const ELEVATED_ROLES = ["system_owner", "admin"] as const;
function isElevatedRole(role: string): boolean {
  return (ELEVATED_ROLES as readonly string[]).includes(role);
}

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const effectiveOrgId = isSystemOwner(user) && req.query.organizationId
    ? parseInt(req.query.organizationId as string)
    : user.organizationId;

  let query = db.select({
    project: projectsTable,
    orgName: organizationsTable.name,
  }).from(projectsTable).leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id));

  let projects = effectiveOrgId
    ? (await query).filter(p => p.project.organizationId === effectiveOrgId)
    : await query;

  // Non-elevated users only see projects they are explicitly assigned to.
  // Admins and system owners see all projects in the organization.
  if (!isElevatedRole(user.role)) {
    const memberships = await db
      .select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, user.id));
    const accessibleIds = new Set(memberships.map(m => m.projectId));
    projects = projects.filter(p => accessibleIds.has(p.project.id));
  }

  const memberCounts = await db.select({ projectId: projectMembersTable.projectId, cnt: count() }).from(projectMembersTable).groupBy(projectMembersTable.projectId);
  const docCounts = await db.select({ projectId: documentsTable.projectId, cnt: count() }).from(documentsTable).groupBy(documentsTable.projectId);

  const mcMap = new Map(memberCounts.map(r => [r.projectId, Number(r.cnt)]));
  const dcMap = new Map(docCounts.map(r => [r.projectId, Number(r.cnt)]));

  res.json({
    projects: projects.map(({ project, orgName }) => ({
      ...project,
      organizationName: orgName,
      memberCount: mcMap.get(project.id) ?? 0,
      documentCount: dcMap.get(project.id) ?? 0,
    })),
    total: projects.length,
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const { name, code, description, status, startDate, endDate } = req.body;
  const organizationId = isSystemOwner(user) && req.body.organizationId
    ? parseInt(String(req.body.organizationId))
    : user.organizationId;

  // ── Field validation (schema-based, no hardcoded business limits) ──────────
  const fieldErrors: Record<string, string> = {};

  if (!name || typeof name !== "string" || !name.trim()) {
    fieldErrors.name = "Project name is required";
  } else if (name.trim().length < 2) {
    fieldErrors.name = "Project name must be at least 2 characters";
  }

  if (!code || typeof code !== "string" || !code.trim()) {
    fieldErrors.code = "Project code is required";
  } else if (!CODE_PATTERN.test(code.trim())) {
    fieldErrors.code = "Code may only contain letters, numbers, hyphens, and underscores";
  }

  if (!organizationId || isNaN(organizationId)) {
    fieldErrors.organizationId = "Organization is required";
  }

  const resolvedStatus: ProjectStatus = (VALID_STATUSES as readonly string[]).includes(status)
    ? status
    : "active";

  if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
    fieldErrors.status = `Status must be one of: ${VALID_STATUSES.join(", ")}`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      error: "Validation failed",
      message: "One or more fields are invalid",
      fields: fieldErrors,
    });
    return;
  }

  // ── Pre-insert business checks ─────────────────────────────────────────────
  // 1. Verify the organization exists
  const [org] = await db
    .select({ id: organizationsTable.id, subscriptionTier: organizationsTable.subscriptionTier, trialEndsAt: organizationsTable.trialEndsAt })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId!))
    .limit(1);

  if (!org) {
    res.status(400).json({
      error: "Validation failed",
      message: "The selected organization does not exist",
      fields: { organizationId: "Organization not found" },
    });
    return;
  }

  // ── Trial expiry gate (trial-specific) ────────────────────────────────────
  if (org.subscriptionTier === "trial" && org.trialEndsAt && new Date() > new Date(org.trialEndsAt)) {
    res.status(403).json({
      error: "TRIAL_EXPIRED",
      message: "Your 14-day trial has ended. Upgrade to a paid plan to create new projects.",
    });
    return;
  }

  // ── Per-plan project limit (applies to any plan that defines maxProjects) ──
  // Currently: trial = 1, free = 1. Higher tiers have no cap (maxProjects = null).
  const planForLimitCheck = PLANS.find(p => p.id === (org.subscriptionTier ?? "free"));
  if (planForLimitCheck?.maxProjects != null) {
    const [{ projectCount }] = await db
      .select({ projectCount: count() })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, organizationId!));

    if (projectCount >= planForLimitCheck.maxProjects) {
      res.status(403).json({
        error: "PROJECT_LIMIT_REACHED",
        message: `Your ${planForLimitCheck.name} plan allows up to ${planForLimitCheck.maxProjects} project${planForLimitCheck.maxProjects !== 1 ? "s" : ""}. Upgrade to add more.`,
      });
      return;
    }
  }

  // 2. Enforce per-organization code uniqueness (more granular than the DB unique index)
  const [duplicate] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.code, code.trim().toUpperCase()),
      eq(projectsTable.organizationId, organizationId!),
    ))
    .limit(1);

  // Also check case-insensitively (codes are stored as-entered but checked case-insensitively)
  const [duplicateCi] = !duplicate
    ? await db
        .select({ id: projectsTable.id, code: projectsTable.code })
        .from(projectsTable)
        .where(and(
          eq(projectsTable.organizationId, organizationId!),
        ))
        .then(rows => rows.filter(r => r.code.toUpperCase() === code.trim().toUpperCase()))
    : [undefined];

  if (duplicate || duplicateCi) {
    res.status(400).json({
      error: "Validation failed",
      message: "Project code already in use",
      fields: { code: `A project with code "${code.trim()}" already exists in this organization` },
    });
    return;
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  try {
    const [project] = await db.insert(projectsTable).values({
      name: name.trim(),
      code: code.trim(),
      description: description?.trim() || null,
      status: resolvedStatus,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      organizationId: organizationId!,
    }).returning();

    await db.insert(projectMembersTable).values({ projectId: project.id, userId: user.id, role: "admin" });
    await createAuditLog({
      userId: user.id,
      action: "create",
      entityType: "project",
      entityId: project.id,
      entityTitle: project.name,
      projectId: project.id,
    });

    res.status(201).json({ ...project, memberCount: 1, documentCount: 0 });
  } catch (err: unknown) {
    logger.error({ err }, "Project insert failed");

    const code_ = pgErrCode(err);
    if (code_ === "23505") {
      // Unique constraint — code already taken globally
      res.status(400).json({
        error: "Validation failed",
        message: "Project code already in use",
        fields: { code: "This project code is already taken. Please choose a different code." },
      });
      return;
    }
    if (code_ === "23503") {
      // Foreign key — org doesn't exist
      res.status(400).json({
        error: "Validation failed",
        message: "Organization not found",
        fields: { organizationId: "The selected organization does not exist" },
      });
      return;
    }
    if (code_ === "23502") {
      // Not-null violation
      res.status(400).json({
        error: "Validation failed",
        message: "A required field is missing",
      });
      return;
    }
    if (code_ === "22P02") {
      // Invalid enum or type cast
      res.status(400).json({
        error: "Validation failed",
        message: "One or more field values are invalid",
      });
      return;
    }

    res.status(500).json({ error: "Internal server error", message: "Failed to create project. Please try again." });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const results = await db.select({ project: projectsTable, orgName: organizationsTable.name })
    .from(projectsTable)
    .leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(eq(projectsTable.id, id))
    .limit(1);

  if (!results[0]) { res.status(404).json({ error: "Not Found" }); return; }

  if (!isSystemOwner(user) && results[0].project.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const mc = await db.select({ cnt: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, id));
  const dc = await db.select({ cnt: count() }).from(documentsTable).where(eq(documentsTable.projectId, id));
  res.json({ ...results[0].project, organizationName: results[0].orgName, memberCount: Number(mc[0]?.cnt ?? 0), documentCount: Number(dc[0]?.cnt ?? 0) });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }
  if (!isSystemOwner(user) && existing.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { name, code, description, status, startDate, endDate } = req.body;
  const organizationId = isSystemOwner(user) && req.body.organizationId ? req.body.organizationId : existing.organizationId;

  // Validate status
  if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
    res.status(400).json({
      error: "Validation failed",
      fields: { status: `Status must be one of: ${VALID_STATUSES.join(", ")}` },
    });
    return;
  }

  // Validate code if changed
  if (code && code !== existing.code) {
    if (!CODE_PATTERN.test(code.trim())) {
      res.status(400).json({
        error: "Validation failed",
        fields: { code: "Code may only contain letters, numbers, hyphens, and underscores" },
      });
      return;
    }
    // Check uniqueness in org (excluding self)
    const rows = await db
      .select({ id: projectsTable.id, code: projectsTable.code })
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, organizationId));
    const conflict = rows.find(r => r.code.toUpperCase() === code.trim().toUpperCase() && r.id !== id);
    if (conflict) {
      res.status(400).json({
        error: "Validation failed",
        fields: { code: `A project with code "${code.trim()}" already exists in this organization` },
      });
      return;
    }
  }

  try {
    const [project] = await db.update(projectsTable)
      .set({
        name: name?.trim() ?? existing.name,
        code: code?.trim() ?? existing.code,
        description: description !== undefined ? (description?.trim() || null) : existing.description,
        status: status ?? existing.status,
        startDate: startDate ? new Date(startDate) : existing.startDate,
        endDate: endDate ? new Date(endDate) : existing.endDate,
        organizationId,
        updatedAt: new Date(),
      })
      .where(eq(projectsTable.id, id))
      .returning();
    res.json({ ...project, memberCount: 0, documentCount: 0 });
  } catch (err: unknown) {
    logger.error({ err }, "Project update failed");
    const errCode = pgErrCode(err);
    if (errCode === "23505") {
      res.status(400).json({ error: "Validation failed", fields: { code: "This project code is already taken" } });
      return;
    }
    res.status(500).json({ error: "Internal server error", message: "Failed to update project" });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = req.user!;
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not Found" }); return; }
  if (!isSystemOwner(user) && existing.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
});

// ─── GET /:id/members ─────────────────────────────────────────────────────────
router.get("/:id/members", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const members = await db.select({
    member: projectMembersTable,
    user: usersTable,
  }).from(projectMembersTable)
    .leftJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, id));

  res.json({
    members: members.map(({ member, user }) => ({
      id: member.id,
      userId: member.userId,
      projectId: member.projectId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: user ? {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive, organizationId: user.organizationId, createdAt: user.createdAt,
      } : undefined,
    })),
    total: members.length,
  });
});

router.post("/:id/members", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { userId, role } = req.body;

  if (!userId || isNaN(parseInt(String(userId)))) {
    res.status(400).json({ error: "Validation failed", message: "A valid user is required" });
    return;
  }

  // Verify project exists
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
  if (!project) {
    res.status(404).json({ error: "Not Found", message: "Project not found" });
    return;
  }

  // Verify user exists
  const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, parseInt(String(userId)))).limit(1);
  if (!targetUser) {
    res.status(400).json({ error: "Validation failed", message: "User not found" });
    return;
  }

  // Check if already a member
  const [existing] = await db.select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, id), eq(projectMembersTable.userId, parseInt(String(userId)))))
    .limit(1);
  if (existing) {
    res.status(400).json({ error: "Validation failed", message: "User is already a member of this project" });
    return;
  }

  try {
    const [member] = await db.insert(projectMembersTable).values({ projectId: id, userId: parseInt(String(userId)), role: role || "viewer" }).returning();
    res.status(201).json({ ...member });
  } catch (err: unknown) {
    logger.error({ err }, "Add project member failed");
    const errCode = pgErrCode(err);
    if (errCode === "23503") {
      res.status(400).json({ error: "Validation failed", message: "User or project not found" });
      return;
    }
    res.status(500).json({ error: "Internal server error", message: "Failed to add member" });
  }
});

router.delete("/:id/members/:userId", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const userId = parseInt(req.params.userId);
  await db.delete(projectMembersTable).where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));
  res.status(204).send();
});

export default router;
