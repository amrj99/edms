import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, projectPartiesTable, organizationsTable, usersTable, documentsTable } from "@workspace/db";
import { eq, count, and, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireAuth, isSysAdmin, isSystemOwner } from "../lib/auth.js";
import { canAccessProject } from "../lib/can-access-project.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { requireMinRole, hasMinRole } from "../middlewares/require-role.js";
import { createAuditLog } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { PLANS } from "../lib/plans.js";
import { normalizePlanId } from "../lib/plan-normalizer.js";
import {param, paramInt, requireInt, queryIntOrNull} from '../lib/params';
import { TenantIsolationError } from '../lib/errors.js';

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


// ─── GET / ────────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const effectiveOrgId = isSystemOwner(user) && req.query.organizationId
    ? queryIntOrNull(req.query.organizationId)
    : user.organizationId;

  // Tenant isolation: always filter at the DB level — never in-memory.
  // Non-sysOwner users MUST have an org; if somehow missing, return empty list (fail-safe).
  if (!isSystemOwner(user) && !effectiveOrgId) {
    res.json({ items: [], total: 0 }); return;
  }

  const orgFilter = effectiveOrgId
    ? eq(projectsTable.organizationId, effectiveOrgId)
    : isNotNull(projectsTable.organizationId); // sysOwner with no org filter → all orgs

  const data = await tenantRead(async () => {
    const projects = await db.select({
      project: projectsTable,
      orgName: organizationsTable.name,
    }).from(projectsTable)
      .leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
      .where(orgFilter);

    // Non-elevated users only see projects they are explicitly assigned to.
    const memberships = !hasMinRole(user, "admin")
      ? await db
          .select({ projectId: projectMembersTable.projectId })
          .from(projectMembersTable)
          .where(eq(projectMembersTable.userId, user.id))
      : null;

    // ── Party project discovery (Phase 6C) ──────────────────────────────────
    // Invariant I-10: every project in this list must satisfy canAccessProject()
    // for the same caller — the list must never be broader than the detail gate.
    // Both conditions below mirror the party branch of canAccessProject():
    //   removed_at IS NULL          → revocation takes effect on the next request
    //   collaboration_mode='parties' → stale party rows on org_only projects never leak
    // Party access is org-wide (no project_members check), matching the detail gate.
    const partyRows = (!isSystemOwner(user) && user.organizationId)
      ? await db.select({
          project: projectsTable,
          orgName: organizationsTable.name,
          partyRole: projectPartiesTable.partyRole,
        }).from(projectPartiesTable)
          .innerJoin(projectsTable, eq(projectPartiesTable.projectId, projectsTable.id))
          .leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
          .where(and(
            eq(projectPartiesTable.organizationId, user.organizationId),
            isNull(projectPartiesTable.removedAt),
            eq(projectsTable.collaborationMode, "parties"),
          ))
      : [];

    const memberCounts = await db.select({ projectId: projectMembersTable.projectId, cnt: count() }).from(projectMembersTable).groupBy(projectMembersTable.projectId);
    const docCounts = await db.select({ projectId: documentsTable.projectId, cnt: count() }).from(documentsTable).groupBy(documentsTable.projectId);

    return { projects, memberships, partyRows, memberCounts, docCounts };
  });

  // ── Pure JS assembly (outside the read tx) ──────────────────────────────────
  let projects = data.projects;

  if (!hasMinRole(user, "admin")) {
    const accessibleIds = new Set(data.memberships!.map(m => m.projectId));
    projects = projects.filter(p => accessibleIds.has(p.project.id));
  }

  // Hide trial-downgraded projects for all non-system-owner users.
  // visible_on_free defaults to true so non-downgraded orgs are unaffected.
  if (!isSystemOwner(user)) {
    projects = projects.filter(p => p.project.visibleOnFree);
  }

  const partyRoleMap = new Map<number, string>();
  if (!isSystemOwner(user) && user.organizationId) {
    const ownIds = new Set(projects.map(p => p.project.id));
    for (const row of data.partyRows) {
      if (ownIds.has(row.project.id)) continue; // defensive dedupe — owner org cannot be its own party
      if (!row.project.visibleOnFree) continue;
      partyRoleMap.set(row.project.id, row.partyRole);
      projects.push({ project: row.project, orgName: row.orgName });
    }
  }

  const mcMap = new Map(data.memberCounts.map(r => [r.projectId, Number(r.cnt)]));
  const dcMap = new Map(data.docCounts.map(r => [r.projectId, Number(r.cnt)]));

  res.json({
    items: projects.map(({ project, orgName }) => ({
      ...project,
      organizationName: orgName,
      memberCount: mcMap.get(project.id) ?? 0,
      documentCount: dcMap.get(project.id) ?? 0,
      accessMode: partyRoleMap.has(project.id) ? "party" : "intra_org",
      ...(partyRoleMap.has(project.id) ? { partyRole: partyRoleMap.get(project.id) } : {}),
    })),
    total: projects.length,
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res): Promise<void> => {
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

  // ── Pre-insert business checks + insert — all DB work in one tenant tx ───────
  try {
    const outcome = await withTenant(async () => {
      // 1. Verify the organization exists
      const [org] = await db
        .select({ id: organizationsTable.id, subscriptionTier: organizationsTable.subscriptionTier, trialEndsAt: organizationsTable.trialEndsAt })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, organizationId!))
        .limit(1);
      if (!org) return { kind: "no-org" as const };

      // ── Trial expiry gate (trial-specific) ────────────────────────────────
      if (org.subscriptionTier === "trial" && org.trialEndsAt && new Date() > new Date(org.trialEndsAt)) {
        return { kind: "trial-expired" as const };
      }

      // ── Per-plan project limit (any plan that defines maxProjects) ─────────
      const planForLimitCheck = PLANS.find(p => p.id === normalizePlanId(org.subscriptionTier));
      if (planForLimitCheck?.maxProjects != null) {
        const [{ projectCount }] = await db
          .select({ projectCount: count() })
          .from(projectsTable)
          .where(eq(projectsTable.organizationId, organizationId!));
        if (projectCount >= planForLimitCheck.maxProjects) {
          return { kind: "limit" as const, planName: planForLimitCheck.name, maxProjects: planForLimitCheck.maxProjects };
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

      if (duplicate || duplicateCi) return { kind: "dup-code" as const };

      // ── Insert ───────────────────────────────────────────────────────────
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
        return { kind: "ok" as const, project };
      } catch (err: unknown) {
        const code_ = pgErrCode(err);
        if (code_ === "23505") return { kind: "pg-dup" as const };
        if (code_ === "23503") return { kind: "pg-fk" as const };
        if (code_ === "23502") return { kind: "pg-notnull" as const };
        if (code_ === "22P02") return { kind: "pg-enum" as const };
        throw err; // unknown → bubble to the outer 500
      }
    });

    switch (outcome.kind) {
      case "no-org":
        res.status(400).json({ error: "Validation failed", message: "The selected organization does not exist", fields: { organizationId: "Organization not found" } }); return;
      case "trial-expired":
        res.status(403).json({ error: "TRIAL_EXPIRED", message: "Your 14-day trial has ended. Upgrade to a paid plan to create new projects." }); return;
      case "limit":
        res.status(403).json({ error: "PROJECT_LIMIT_REACHED", message: `Your ${outcome.planName} plan allows up to ${outcome.maxProjects} project${outcome.maxProjects !== 1 ? "s" : ""}. Upgrade to add more.` }); return;
      case "dup-code":
        res.status(400).json({ error: "Validation failed", message: "Project code already in use", fields: { code: `A project with code "${code.trim()}" already exists in this organization` } }); return;
      case "pg-dup":
        res.status(400).json({ error: "Validation failed", message: "Project code already in use", fields: { code: "This project code is already taken. Please choose a different code." } }); return;
      case "pg-fk":
        res.status(400).json({ error: "Validation failed", message: "Organization not found", fields: { organizationId: "The selected organization does not exist" } }); return;
      case "pg-notnull":
        res.status(400).json({ error: "Validation failed", message: "A required field is missing" }); return;
      case "pg-enum":
        res.status(400).json({ error: "Validation failed", message: "One or more field values are invalid" }); return;
      default:
        res.status(201).json({ ...outcome.project, memberCount: 1, documentCount: 0 }); return;
    }
  } catch (err: unknown) {
    logger.error({ err }, "Project insert failed");
    res.status(500).json({ error: "Internal server error", message: "Failed to create project. Please try again." });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;

  const result = await tenantRead(async () => {
    const results = await db.select({ project: projectsTable, orgName: organizationsTable.name })
      .from(projectsTable)
      .leftJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
      .where(eq(projectsTable.id, id))
      .limit(1);

    if (!results[0]) return { kind: "notfound" as const };

    // Party members can view projects they are active parties to (Phase 5, ADR-011)
    const { allowed, mode, partyRole } = await canAccessProject(user.id, user.organizationId, id, isSystemOwner(user));
    if (!allowed) return { kind: "forbidden" as const };

    const mc = await db.select({ cnt: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, id));
    const dc = await db.select({ cnt: count() }).from(documentsTable).where(eq(documentsTable.projectId, id));
    return { kind: "ok" as const, project: results[0].project, orgName: results[0].orgName, mode, partyRole, mc, dc };
  });

  if (result.kind === "notfound") { res.status(404).json({ error: "Not Found" }); return; }
  if (result.kind === "forbidden") { res.status(403).json({ error: "Forbidden" }); return; }

  res.json({
    ...result.project,
    organizationName: result.orgName,
    memberCount: Number(result.mc[0]?.cnt ?? 0),
    documentCount: Number(result.dc[0]?.cnt ?? 0),
    // Phase 6C: expose the resolved access mode so the UI can gate party views.
    // Purely informational — enforcement stays in canAccessProject + ceilings.
    accessMode: result.mode,
    ...(result.partyRole ? { partyRole: result.partyRole } : {}),
  });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;
  const { name, code, description, status, startDate, endDate } = req.body;

  // Non-DB validation first (no tx needed).
  if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
    res.status(400).json({ error: "Validation failed", fields: { status: `Status must be one of: ${VALID_STATUSES.join(", ")}` } });
    return;
  }

  try {
    const outcome = await withTenant(async () => {
      const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
      if (!existing) return { kind: "notfound" as const };
      if (!isSystemOwner(user) && existing.organizationId !== user.organizationId) return { kind: "forbidden" as const };

      const organizationId = isSystemOwner(user) && req.body.organizationId ? req.body.organizationId : existing.organizationId;

      // Validate code if changed
      if (code && code !== existing.code) {
        if (!CODE_PATTERN.test(code.trim())) return { kind: "bad-code" as const };
        // Check uniqueness in org (excluding self)
        const rows = await db
          .select({ id: projectsTable.id, code: projectsTable.code })
          .from(projectsTable)
          .where(eq(projectsTable.organizationId, organizationId));
        const conflict = rows.find(r => r.code.toUpperCase() === code.trim().toUpperCase() && r.id !== id);
        if (conflict) return { kind: "dup-code" as const };
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
        return { kind: "ok" as const, project };
      } catch (err: unknown) {
        if (pgErrCode(err) === "23505") return { kind: "pg-dup" as const };
        throw err;
      }
    });

    switch (outcome.kind) {
      case "notfound": res.status(404).json({ error: "Not Found" }); return;
      case "forbidden": res.status(403).json({ error: "Forbidden" }); return;
      case "bad-code": res.status(400).json({ error: "Validation failed", fields: { code: "Code may only contain letters, numbers, hyphens, and underscores" } }); return;
      case "dup-code": res.status(400).json({ error: "Validation failed", fields: { code: `A project with code "${code.trim()}" already exists in this organization` } }); return;
      case "pg-dup": res.status(400).json({ error: "Validation failed", fields: { code: "This project code is already taken" } }); return;
      default: res.json({ ...outcome.project, memberCount: 0, documentCount: 0 }); return;
    }
  } catch (err: unknown) {
    logger.error({ err }, "Project update failed");
    res.status(500).json({ error: "Internal server error", message: "Failed to update project" });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;
  try {
    const outcome = await withTenant(async () => {
      const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
      if (!existing) return { kind: "notfound" as const };
      if (!isSystemOwner(user) && existing.organizationId !== user.organizationId) return { kind: "forbidden" as const };
      await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, id));
      await db.delete(projectsTable).where(eq(projectsTable.id, id));
      return { kind: "ok" as const };
    });
    if (outcome.kind === "notfound") { res.status(404).json({ error: "Not Found" }); return; }
    if (outcome.kind === "forbidden") { res.status(403).json({ error: "Forbidden" }); return; }
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── GET /:id/members ─────────────────────────────────────────────────────────
router.get("/:id/members", requireAuth, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  const user = req.user!;

  const result = await tenantRead(async () => {
    // Tenant isolation: verify project belongs to the user's org
    if (!isSystemOwner(user) && user.organizationId) {
      const [project] = await db.select({ organizationId: projectsTable.organizationId })
        .from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
      if (!project) return { kind: "notfound" as const };
      if (project.organizationId !== user.organizationId) {
        throw new TenantIsolationError({
          route: req.path, method: req.method,
          userId: user.id, userOrgId: user.organizationId,
          attemptedResourceType: "project_members", attemptedResourceId: id,
          projectOrgId: project.organizationId,
        });
      }
    }

    const members = await db.select({
      member: projectMembersTable,
      user: usersTable,
    }).from(projectMembersTable)
      .leftJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
      .where(eq(projectMembersTable.projectId, id));

    return { kind: "ok" as const, members };
  });

  if (result.kind === "notfound") { res.status(404).json({ error: "Not Found" }); return; }

  res.json({
    members: result.members.map(({ member, user }) => ({
      id: member.id,
      userId: member.userId,
      projectId: member.projectId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: user ? {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive, organizationId: user.organizationId, createdAt: user.createdAt,
      } : undefined,
    })),
    total: result.members.length,
  });
});

router.post("/:id/members", requireAuth, async (req, res, next): Promise<void> => {
  const id = requireInt(req.params.id);
  const caller = req.user!;
  const { userId, role } = req.body;

  if (!userId || isNaN(parseInt(String(userId)))) {
    res.status(400).json({ error: "Validation failed", message: "A valid user is required" });
    return;
  }

  try {
    const outcome = await withTenant(async () => {
      // Verify project exists + tenant isolation
      const [project] = await db.select({ id: projectsTable.id, organizationId: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
      if (!project) return { kind: "notfound" as const };

      // Verify project belongs to caller's org (throws → global error handler)
      if (!isSystemOwner(caller) && caller.organizationId && project.organizationId !== caller.organizationId) {
        throw new TenantIsolationError({
          route: req.path, method: req.method,
          userId: caller.id, userOrgId: caller.organizationId,
          attemptedResourceType: "project_member_add", attemptedResourceId: id,
          projectOrgId: project.organizationId, targetUserId: userId,
        });
      }

      // Verify user exists
      const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, parseInt(String(userId)))).limit(1);
      if (!targetUser) return { kind: "no-user" as const };

      // Check if already a member
      const [existing] = await db.select({ id: projectMembersTable.id })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, id), eq(projectMembersTable.userId, parseInt(String(userId)))))
        .limit(1);
      if (existing) return { kind: "dup-member" as const };

      try {
        const [member] = await db.insert(projectMembersTable).values({ projectId: id, userId: parseInt(String(userId)), role: role || "viewer" }).returning();
        return { kind: "ok" as const, member };
      } catch (err: unknown) {
        if (pgErrCode(err) === "23503") return { kind: "pg-fk" as const };
        throw err;
      }
    });

    switch (outcome.kind) {
      case "notfound": res.status(404).json({ error: "Not Found", message: "Project not found" }); return;
      case "no-user": res.status(400).json({ error: "Validation failed", message: "User not found" }); return;
      case "dup-member": res.status(400).json({ error: "Validation failed", message: "User is already a member of this project" }); return;
      case "pg-fk": res.status(400).json({ error: "Validation failed", message: "User or project not found" }); return;
      default: res.status(201).json({ ...outcome.member }); return;
    }
  } catch (err: unknown) {
    if (err instanceof TenantIsolationError) { next(err); return; }
    logger.error({ err }, "Add project member failed");
    res.status(500).json({ error: "Internal server error", message: "Failed to add member" });
  }
});

router.delete("/:id/members/:userId", requireAuth, async (req, res, next): Promise<void> => {
  const projectId = requireInt(req.params.id);
  const userId = requireInt(req.params.userId);
  const caller = req.user!;

  try {
    const outcome = await withTenant(async () => {
      // Verify project exists + tenant isolation (mirror POST /:id/members)
      const [project] = await db.select({ id: projectsTable.id, organizationId: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
      if (!project) return { kind: "notfound" as const };

      // Verify project belongs to caller's org (throws → global error handler)
      if (!isSystemOwner(caller) && caller.organizationId && project.organizationId !== caller.organizationId) {
        throw new TenantIsolationError({
          route: req.path, method: req.method,
          userId: caller.id, userOrgId: caller.organizationId,
          attemptedResourceType: "project_member_remove", attemptedResourceId: projectId,
          projectOrgId: project.organizationId, targetUserId: userId,
        });
      }

      await db.delete(projectMembersTable).where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));
      return { kind: "ok" as const };
    });
    if (outcome.kind === "notfound") { res.status(404).json({ error: "Not Found", message: "Project not found" }); return; }
    res.status(204).send();
  } catch (e) { next(e); }
});

export default router;
