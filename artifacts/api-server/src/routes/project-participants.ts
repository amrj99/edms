import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  projectParticipantsTable,
  projectsTable,
  entitiesTable,
  participantRoleEnum,
} from "@workspace/db";
import { requireAuth } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { parseBody } from "../lib/validate.js";
import { requireInt, type ProjectParams } from "../lib/params.js";
import { z } from "zod";

const router = Router({ mergeParams: true });

router.use(requireAuth);

// ─── Validation ───────────────────────────────────────────────────────────────

const PARTICIPANT_ROLES = [
  "owner", "consultant", "main_contractor",
  "sub_contractor", "supplier", "authority", "other",
] as const;

const createParticipantSchema = z.object({
  entityId: z.number().int().positive(),
  role:     z.enum(PARTICIPANT_ROLES),
  notes:    z.string().max(1000).optional(),
});

const updateParticipantSchema = z.object({
  role:  z.enum(PARTICIPANT_ROLES).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ─── Helper: resolve caller org + verify project belongs to it ────────────────

async function resolveProjectOrg(
  req: Request<ProjectParams>,
  res: any,
): Promise<{ projectOrgId: number; projectId: number } | null> {
  const projectId = requireInt(req.params.projectId);
  const caller = (req as any).user;

  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }

  const projectOrgId = project.organizationId;

  // Only system_owner (cross-tenant) may access any project.
  // Org-level admins are still scoped to their own org.
  if (caller.role !== "system_owner" && caller.organizationId !== projectOrgId) {
    res.status(404).json({ error: "Project not found" }); return null;
  }

  return { projectOrgId, projectId };
}

// ─── GET /api/projects/:projectId/participants ────────────────────────────────

router.get("/participants", async (req: Request<ProjectParams>, res): Promise<void> => {
  const ctx = await resolveProjectOrg(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id:         projectParticipantsTable.id,
      role:       projectParticipantsTable.role,
      notes:      projectParticipantsTable.notes,
      createdAt:  projectParticipantsTable.createdAt,
      updatedAt:  projectParticipantsTable.updatedAt,
      entity: {
        id:                 entitiesTable.id,
        name:               entitiesTable.name,
        type:               entitiesTable.type,
        country:            entitiesTable.country,
        registrationNumber: entitiesTable.registrationNumber,
      },
    })
    .from(projectParticipantsTable)
    .innerJoin(entitiesTable, eq(entitiesTable.id, projectParticipantsTable.entityId))
    .where(eq(projectParticipantsTable.projectId, ctx.projectId))
    .orderBy(projectParticipantsTable.role, entitiesTable.name);

  res.json(rows);
});

// ─── POST /api/projects/:projectId/participants ───────────────────────────────

router.post(
  "/participants",
  requireMinRole("admin"),
  parseBody(createParticipantSchema),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const ctx = await resolveProjectOrg(req, res);
    if (!ctx) return;

    const { entityId, role, notes } = req.body as z.infer<typeof createParticipantSchema>;

    // Tenant isolation: entity must belong to the same org as the project
    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(
        eq(entitiesTable.id, entityId),
        eq(entitiesTable.organizationId, ctx.projectOrgId),
      ))
      .limit(1);

    if (!entity) {
      res.status(404).json({ error: "Entity not found in this organization" }); return;
    }

    // Unique constraint: (project_id, entity_id)
    const [existing] = await db
      .select({ id: projectParticipantsTable.id })
      .from(projectParticipantsTable)
      .where(and(
        eq(projectParticipantsTable.projectId, ctx.projectId),
        eq(projectParticipantsTable.entityId, entityId),
      ))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Entity is already a participant in this project" }); return;
    }

    const [row] = await db
      .insert(projectParticipantsTable)
      .values({
        projectId: ctx.projectId,
        entityId,
        role,
        notes: notes?.trim() || null,
      })
      .returning();

    res.status(201).json(row);
  },
);

// ─── PUT /api/projects/:projectId/participants/:id ────────────────────────────

router.put(
  "/participants/:id",
  requireMinRole("admin"),
  parseBody(updateParticipantSchema),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const ctx = await resolveProjectOrg(req, res);
    if (!ctx) return;

    const participantId = requireInt(req.params.id);

    const [existing] = await db
      .select({ id: projectParticipantsTable.id })
      .from(projectParticipantsTable)
      .where(and(
        eq(projectParticipantsTable.id, participantId),
        eq(projectParticipantsTable.projectId, ctx.projectId),
      ))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Participant not found" }); return; }

    const { role, notes } = req.body as z.infer<typeof updateParticipantSchema>;

    const [updated] = await db
      .update(projectParticipantsTable)
      .set({
        ...(role  !== undefined && { role }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        updatedAt: new Date(),
      })
      .where(eq(projectParticipantsTable.id, participantId))
      .returning();

    res.json(updated);
  },
);

// ─── DELETE /api/projects/:projectId/participants/:id ─────────────────────────

router.delete(
  "/participants/:id",
  requireMinRole("admin"),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const ctx = await resolveProjectOrg(req, res);
    if (!ctx) return;

    const participantId = requireInt(req.params.id);

    const [existing] = await db
      .select({ id: projectParticipantsTable.id })
      .from(projectParticipantsTable)
      .where(and(
        eq(projectParticipantsTable.id, participantId),
        eq(projectParticipantsTable.projectId, ctx.projectId),
      ))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Participant not found" }); return; }

    await db
      .delete(projectParticipantsTable)
      .where(eq(projectParticipantsTable.id, participantId));

    res.json({ ok: true });
  },
);

export default router;
