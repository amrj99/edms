import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db, skillDefinitionsTable, skillExecutionsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth.js";
import { getReqOrgId } from "../lib/org-scope.js";
import { executeSkill } from "../lib/skill-engine.js";
import {param, paramInt, requireInt} from '../lib/params';

const router = Router();

// All skills endpoints require at minimum org-admin role
const adminOnly = requireRole("admin", "system_owner");

// ─── GET /api/skills — list org skills with last execution status ─────────────
router.get("/", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId = getReqOrgId(req);
  if (!orgId) { res.status(403).json({ error: "No organization context" }); return; }

  const skills = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.organizationId, orgId))
    .orderBy(skillDefinitionsTable.createdAt);

  // Attach last execution for each skill
  const enriched = await Promise.all(
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

  const [skill] = await db
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

  res.status(201).json(skill);
});

// ─── PUT /api/skills/:id — update config / settings ──────────────────────────
router.put("/:id", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  const [existing] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, description, config, isEnabled, triggerType, handlerType } = req.body;

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

  res.json(updated);
});

// ─── DELETE /api/skills/:id ───────────────────────────────────────────────────
router.delete("/:id", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  const [existing] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  // Cascade-delete executions first
  await db.delete(skillExecutionsTable).where(eq(skillExecutionsTable.skillId, skillId));
  await db.delete(skillDefinitionsTable).where(eq(skillDefinitionsTable.id, skillId));

  res.status(204).send();
});

// ─── PUT /api/skills/:id/toggle — enable / disable ───────────────────────────
router.put("/:id/toggle", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  const [existing] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db
    .update(skillDefinitionsTable)
    .set({ isEnabled: !existing.isEnabled, updatedAt: new Date() })
    .where(eq(skillDefinitionsTable.id, skillId))
    .returning();

  res.json({ id: updated.id, isEnabled: updated.isEnabled });
});

// ─── PUT /api/skills/:id/run — manual execution ──────────────────────────────
router.put("/:id/run", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);

  const [existing] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  // Fire-and-forget — respond immediately
  executeSkill(skillId, { triggeredByType: "manual", triggeredById: req.user!.id }).catch(() => {});

  res.json({ message: "Skill execution started", skillId });
});

// ─── GET /api/skills/:id/executions — execution history ──────────────────────
router.get("/:id/executions", requireAuth, adminOnly, async (req, res): Promise<void> => {
  const orgId   = getReqOrgId(req);
  const skillId = requireInt(req.params.id);
  const limit   = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const [existing] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
  if (existing.organizationId !== orgId) { res.status(403).json({ error: "Forbidden" }); return; }

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

  res.json(executions);
});

export default router;
