import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db, skillDefinitionsTable, skillExecutionsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { getReqOrgId } from "../lib/org-scope.js";
import { executeSkillBackground } from "../lib/skill-events.js";
import {param, paramInt, requireInt, queryIntOr} from '../lib/params';

const router = Router();

// All skills endpoints require at minimum org-admin role
const adminOnly = requireRole("admin", "system_owner");

// ─── GET /api/skills — list org skills with last execution status ─────────────
router.get("/", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId = getReqOrgId(req);
  if (!orgId) { res.status(403).json({ error: "No organization context" }); return; }

  // List + per-skill last-execution fan-out inside ONE short tenant read tx.
  const enriched = await tenantRead(async () => {
    const skills = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.organizationId, orgId))
      .orderBy(skillDefinitionsTable.createdAt);

    // Attach last execution for each skill
    return await Promise.all(
      skills.map(async (s) => {
        const [lastExec] = await db
          .select({
            id:          skillExecutionsTable.id,
            status:      skillExecutionsTable.status,
            executedAt:  skillExecutionsTable.executedAt,
            durationMs:  skillExecutionsTable.durationMs,
          })
          .from(skillExecutionsTable)
          .where(eq(skillExecutionsTable.skillId, s.id))
          .orderBy(desc(skillExecutionsTable.executedAt))
          .limit(1);
        return { ...s, lastExecution: lastExec ?? null };
      }),
    );
  });

  res.json(enriched);
});

// ─── POST /api/skills — create skill ─────────────────────────────────────────
router.post("/", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId = getReqOrgId(req);
  if (!orgId) { res.status(403).json({ error: "No organization context" }); return; }

  const { name, description, triggerType, handlerType, config, isEnabled } = req.body;

  if (!name || !triggerType || !handlerType) {
    res.status(400).json({ error: "name, triggerType, and handlerType are required" })
    return;
  }

  let skill: typeof skillDefinitionsTable.$inferSelect | undefined;
  await withTenant(async () => {
    [skill] = await db
      .insert(skillDefinitionsTable)
      .values({
        organizationId: orgId,
        name,
        description: description ?? null,
        triggerType,
        handlerType,
        config:    config ?? {},
        isEnabled: isEnabled ?? false,
        createdById: req.user!.id,
        createdAt:   new Date(),
        updatedAt:   new Date(),
      })
      .returning();
  });

  res.status(201).json(skill);
});

// ─── PUT /api/skills/:id — update config / settings ──────────────────────────
router.put("/:id", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  const { name, description, config, isEnabled, triggerType, handlerType } = req.body;

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [existing] = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.id, skillId))
      .limit(1);

    if (!existing) { result = { status: 404, body: { error: "Skill not found" } }; return; }
    if (existing.organizationId !== orgId) { result = { status: 403, body: { error: "Forbidden" } }; return; }

    const [updated] = await db
      .update(skillDefinitionsTable)
      .set({
        name:        name        ?? existing.name,
        description: description ?? existing.description,
        config:      config      ?? existing.config,
        isEnabled:   isEnabled   !== undefined ? isEnabled : existing.isEnabled,
        triggerType: triggerType ?? existing.triggerType,
        handlerType: handlerType ?? existing.handlerType,
        updatedAt:   new Date(),
      })
      .where(eq(skillDefinitionsTable.id, skillId))
      .returning();
    result = { status: 200, body: updated };
  });
  res.status(result!.status).json(result!.body);
});

// ─── DELETE /api/skills/:id ───────────────────────────────────────────────────
router.delete("/:id", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [existing] = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.id, skillId))
      .limit(1);

    if (!existing) { result = { status: 404, body: { error: "Skill not found" } }; return; }
    if (existing.organizationId !== orgId) { result = { status: 403, body: { error: "Forbidden" } }; return; }

    // Cascade-delete executions first
    await db.delete(skillExecutionsTable).where(eq(skillExecutionsTable.skillId, skillId));
    await db.delete(skillDefinitionsTable).where(eq(skillDefinitionsTable.id, skillId));
    result = { status: 204, body: null };
  });
  if (result!.status === 204) { res.status(204).send(); return; }
  res.status(result!.status).json(result!.body);
});

// ─── PUT /api/skills/:id/toggle — enable / disable ───────────────────────────
router.put("/:id/toggle", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  let result: { status: number; body: unknown } | undefined;
  await withTenant(async () => {
    const [existing] = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.id, skillId))
      .limit(1);

    if (!existing) { result = { status: 404, body: { error: "Skill not found" } }; return; }
    if (existing.organizationId !== orgId) { result = { status: 403, body: { error: "Forbidden" } }; return; }

    const [updated] = await db
      .update(skillDefinitionsTable)
      .set({ isEnabled: !existing.isEnabled, updatedAt: new Date() })
      .where(eq(skillDefinitionsTable.id, skillId))
      .returning();
    result = { status: 200, body: { id: updated.id, isEnabled: updated.isEnabled } };
  });
  res.status(result!.status).json(result!.body);
});

// ─── PUT /api/skills/:id/run — manual execution ──────────────────────────────
router.put("/:id/run", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  let existing: typeof skillDefinitionsTable.$inferSelect | undefined;
  await tenantRead(async () => {
    [existing] = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.id, skillId))
      .limit(1);
  });

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  // Detached background execution: exits the request ALS + tenant tx, carries the
  // explicit skill/org/user context (DEBT-010 decision B). Fire-and-forget.
  executeSkillBackground(
    { organizationId: existing.organizationId, userId: req.user!.id, skillId },
    { triggeredByType: "manual" },
  );

  res.json({ message: "Skill execution started", skillId });
});

// ─── GET /api/skills/:id/executions — execution history ──────────────────────
router.get("/:id/executions", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);
  const limit   = Math.min(queryIntOr(req.query.limit, 50), 200);

  const outcome = await tenantRead(async () => {
    const [existing] = await db
      .select()
      .from(skillDefinitionsTable)
      .where(eq(skillDefinitionsTable.id, skillId))
      .limit(1);

    if (!existing) return { kind: "notFound" as const };
    if (existing.organizationId !== orgId) return { kind: "forbidden" as const };

    const executions = await db
      .select()
      .from(skillExecutionsTable)
      .where(
        and(
          eq(skillExecutionsTable.skillId, skillId),
          eq(skillExecutionsTable.organizationId, orgId),
        ),
      )
      .orderBy(desc(skillExecutionsTable.executedAt))
      .limit(limit);

    return { kind: "ok" as const, executions };
  });

  if (outcome.kind === "notFound") { res.status(404).json({ error: "Skill not found" }); return; }
  if (outcome.kind === "forbidden") { res.status(403).json({ error: "Forbidden" }); return; }

  res.json(outcome.executions);
});

export default router;
