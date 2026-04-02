/**
 * Rules Engine CRUD — GET/POST/PUT/DELETE /api/rules
 * Admin and system_owner only (except GET which is open to all authed users).
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { rulesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const role = req.user?.role;
  const allowed = ["admin", "system_owner", "project_manager"];
  if (!allowed.includes(role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// GET /api/rules — list all rules for the user's org
router.get("/", requireAuth, async (req, res) => {
  const orgId = req.user!.organizationId;
  if (!orgId) return res.json({ rules: [] });
  const rules = await db.select().from(rulesTable)
    .where(eq(rulesTable.organizationId, orgId))
    .orderBy(asc(rulesTable.priority), asc(rulesTable.id));
  res.json({ rules });
});

// GET /api/rules/:id
router.get("/:id", requireAuth, async (req, res) => {
  const orgId = req.user!.organizationId;
  const id = parseInt(req.params.id);
  const [rule] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  res.json(rule);
});

// POST /api/rules — create rule
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const {
    name, description, priority, isEnabled, appliesTo, conditions, actions,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

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
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const orgId = req.user!.organizationId;
  const id = parseInt(req.params.id);

  const existing = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!existing[0]) return res.status(404).json({ error: "Rule not found" });

  const {
    name, description, priority, isEnabled, appliesTo, conditions, actions,
  } = req.body;

  const [updated] = await db.update(rulesTable)
    .set({
      name: name?.trim() ?? existing[0].name,
      description: description ?? existing[0].description,
      priority: priority ?? existing[0].priority,
      isEnabled: isEnabled ?? existing[0].isEnabled,
      appliesTo: appliesTo ?? existing[0].appliesTo,
      conditions: conditions ?? existing[0].conditions,
      actions: actions ?? existing[0].actions,
      updatedAt: new Date(),
    })
    .where(eq(rulesTable.id, id))
    .returning();

  res.json(updated);
});

// DELETE /api/rules/:id
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const orgId = req.user!.organizationId;
  const id = parseInt(req.params.id);

  const existing = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!existing[0]) return res.status(404).json({ error: "Rule not found" });

  await db.delete(rulesTable).where(eq(rulesTable.id, id));
  res.status(204).end();
});

// PATCH /api/rules/:id/toggle — quick enable/disable
router.patch("/:id/toggle", requireAuth, requireAdmin, async (req, res) => {
  const orgId = req.user!.organizationId;
  const id = parseInt(req.params.id);

  const [rule] = await db.select().from(rulesTable)
    .where(and(eq(rulesTable.id, id), eq(rulesTable.organizationId, orgId!)));
  if (!rule) return res.status(404).json({ error: "Rule not found" });

  const [updated] = await db.update(rulesTable)
    .set({ isEnabled: !rule.isEnabled, updatedAt: new Date() })
    .where(eq(rulesTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
