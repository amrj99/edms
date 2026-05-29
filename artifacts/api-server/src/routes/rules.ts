/**
 * Rules Engine CRUD — GET/POST/PUT/DELETE /api/rules
 * Admin and system_owner only (except GET which is open to all authed users).
 *
 * Validations enforced:
 *  - Conditions fields must be from the known set (strict schema).
 *  - Action types must be one of: assign_user | assign_team | send_notification.
 *  - Organizations may have at most 100 active rules (HTTP 429 if exceeded).
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { rulesTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { param, paramInt, paramIntOrNull } from '../lib/params';

const router = Router();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const conditionsSchema = z.object({
  documentType:    z.string().optional(),
  discipline:      z.string().optional(),
  projectId:       z.number().optional(),
  subjectContains: z.string().optional(),
  senderUserId:    z.number().optional(),
}).strict(); // Reject unknown condition fields

const actionAssignUser = z.object({
  type:   z.literal("assign_user"),
  config: z.object({ userId: z.number() }),
});

const actionAssignTeam = z.object({
  type:   z.literal("assign_team"),
  config: z.object({
    teamId:   z.union([z.string(), z.number()]).optional(),
    teamName: z.string().optional(),
  }),
});

const actionSendNotification = z.object({
  type:   z.literal("send_notification"),
  config: z.object({
    message: z.string(),
    userIds: z.array(z.number()).optional(),
  }),
});

const actionSchema = z.discriminatedUnion("type", [
  actionAssignUser,
  actionAssignTeam,
  actionSendNotification,
]);

const actionsSchema = z.array(actionSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateConditionsAndActions(
  conditions: unknown,
  actions: unknown,
): { ok: true } | { ok: false; error: string } {
  if (conditions !== undefined && conditions !== null) {
    const parsed = conditionsSchema.safeParse(conditions);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map(i => `conditions.${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { ok: false, error: `Invalid conditions — ${msg}` };
    }
  }

  if (actions !== undefined && actions !== null) {
    const parsed = actionsSchema.safeParse(actions);
    if (!parsed.success) {
      const validTypes = ["assign_user", "assign_team", "send_notification"];
      const unknownType = Array.isArray(actions)
        ? (actions as any[]).find(a => !validTypes.includes(a?.type))?.type
        : null;
      const hint = unknownType
        ? ` Unknown action type "${unknownType}". Valid types: ${validTypes.join(", ")}.`
        : "";
      const msg = parsed.error.issues
        .map(i => `actions[${i.path.join(".")}]: ${i.message}`)
        .join("; ");
      return { ok: false, error: `Invalid actions —${hint} ${msg}` };
    }
  }

  return { ok: true };
}

/** Count of currently active (isEnabled = true) rules for the given org */
async function countActiveRules(orgId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rulesTable)
    .where(and(eq(rulesTable.organizationId, orgId), eq(rulesTable.isEnabled, true)));
  return Number(row?.count ?? 0);
}

const ACTIVE_RULE_LIMIT = 100;

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/rules — list all rules for the user's org
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  if (!orgId) { res.json({ rules: [] }); return; }
  const rules = await db.select().from(rulesTable)
    .where(eq(rulesTable.organizationId, orgId))
    .orderBy(asc(rulesTable.priority), asc(rulesTable.id));
  res.json({ rules });
});

// GET /api/rules/:id
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  const id = paramInt(req.params.id);
  const [rule] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json(rule);
});

// POST /api/rules — create rule
router.post("/", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  if (!orgId) { res.status(400).json({ error: "No organization" }); return; }

  const {
    name, description, priority, isEnabled, appliesTo, conditions, actions,
  } = req.body;

  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  // Validate conditions + actions structure
  const validation = validateConditionsAndActions(conditions, actions);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }

  // Enforce max 100 active rules per org
  const willBeActive = isEnabled !== false; // default true
  if (willBeActive) {
    const activeCount = await countActiveRules(orgId);
    if (activeCount >= ACTIVE_RULE_LIMIT) {
      res.status(429).json({
        error: "Active rule limit reached",
        message: `Organizations may have at most ${ACTIVE_RULE_LIMIT} active rules. ` +
          `Disable or delete some rules before creating new ones. ` +
          `You currently have ${activeCount} active rules.`,
        currentCount: activeCount,
        limit: ACTIVE_RULE_LIMIT,
      })
    return;
    }
  }

  const [rule] = await db.insert(rulesTable).values({
    organizationId: orgId,
    name: name.trim(),
    description: description ?? null,
    priority: priority ?? 0,
    isEnabled: isEnabled ?? true,
    appliesTo: appliesTo ?? "both",
    conditions: conditions ?? {},
    actions: actions ?? [],
    createdById: req.user!.id,
  }).returning();

  res.status(201).json(rule);
});

// PUT /api/rules/:id — update rule
router.put("/:id", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  const id = paramInt(req.params.id);

  const [existing] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

  const {
    name, description, priority, isEnabled, appliesTo, conditions, actions,
  } = req.body;

  // Validate conditions + actions structure
  const validation = validateConditionsAndActions(conditions, actions);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }

  // Enforce max 100 active rules when enabling a currently-disabled rule
  const becomingActive = isEnabled === true && !existing.isEnabled;
  if (becomingActive) {
    const activeCount = await countActiveRules(orgId!);
    if (activeCount >= ACTIVE_RULE_LIMIT) {
      res.status(429).json({
        error: "Active rule limit reached",
        message: `Organizations may have at most ${ACTIVE_RULE_LIMIT} active rules. ` +
          `Disable or delete some rules before enabling this one. ` +
          `You currently have ${activeCount} active rules.`,
        currentCount: activeCount,
        limit: ACTIVE_RULE_LIMIT,
      })
    return;
    }
  }

  const [updated] = await db.update(rulesTable)
    .set({
      name:        name?.trim()       ?? existing.name,
      description: description        ?? existing.description,
      priority:    priority           ?? existing.priority,
      isEnabled:   isEnabled          ?? existing.isEnabled,
      appliesTo:   appliesTo          ?? existing.appliesTo,
      conditions:  conditions         ?? existing.conditions,
      actions:     actions            ?? existing.actions,
      updatedAt:   new Date(),
    })
    .where(eq(rulesTable.id, id))
    .returning();

  res.json(updated);
});

// DELETE /api/rules/:id
router.delete("/:id", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  const id = paramInt(req.params.id);

  const [existing] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

  await db.delete(rulesTable).where(eq(rulesTable.id, id));
  res.status(204).end();
});

// PATCH /api/rules/:id/toggle — quick enable/disable
router.patch("/:id/toggle", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  const id = paramInt(req.params.id);

  const [rule] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

  // Enforce limit when re-enabling a rule
  if (!rule.isEnabled) {
    const activeCount = await countActiveRules(orgId!);
    if (activeCount >= ACTIVE_RULE_LIMIT) {
      res.status(429).json({
        error: "Active rule limit reached",
        message: `Cannot enable this rule: the organization already has ${activeCount} active rules (limit: ${ACTIVE_RULE_LIMIT}).`,
        currentCount: activeCount,
        limit: ACTIVE_RULE_LIMIT,
      })
    return;
    }
  }

  const [updated] = await db.update(rulesTable)
    .set({ isEnabled: !rule.isEnabled, updatedAt: new Date() })
    .where(eq(rulesTable.id, id))
    .returning();

  res.json(updated);
});

// POST /api/rules/:id/reset-circuit — manually reset the circuit breaker
router.post("/:id/reset-circuit", requireAuth, requireMinRole("project_manager"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  const id = paramInt(req.params.id);

  const [rule] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

  const [updated] = await db.update(rulesTable)
    .set({
      consecutiveFailures: 0,
      isCircuitOpen: false,
      lastFailedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(rulesTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
