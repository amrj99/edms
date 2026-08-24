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
import { withTenant } from "../middlewares/tenant-scope.js";
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

// Pure: returns null if the project does not exist OR is out of the caller's
// tenant scope (both surface as 404). Performs a DB read → callers must invoke it
// inside the request's tenant scope (read auto-wrap for GET, withTenant for writes).
async function resolveProjectOrg(
  req: Request<ProjectParams>,
): Promise<{ projectOrgId: number; projectId: number } | null> {
  const projectId = requireInt(req.params.projectId);
  const caller = (req as any).user;

  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return null;

  const projectOrgId = project.organizationId;

  // Only system_owner (cross-tenant) may access any project.
  // Org-level admins are still scoped to their own org.
  if (caller.role !== "system_owner" && caller.organizationId !== projectOrgId) {
    return null;
  }

  return { projectOrgId, projectId };
}

// ─── GET /api/projects/:projectId/participants ────────────────────────────────

router.get("/participants", async (req: Request<ProjectParams>, res): Promise<void> => {
  const ctx = await resolveProjectOrg(req);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }

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
  async (req: Request<ProjectParams>, res, next): Promise<void> => {
    const { entityId, role, notes } = req.body as z.infer<typeof createParticipantSchema>;
    try {
      const outcome = await withTenant(async () => {
        const ctx = await resolveProjectOrg(req);
        if (!ctx) return { kind: "proj-404" as const };

        // Tenant isolation: entity must belong to the same org as the project
        const [entity] = await db
          .select({ id: entitiesTable.id })
          .from(entitiesTable)
          .where(and(
            eq(entitiesTable.id, entityId),
            eq(entitiesTable.organizationId, ctx.projectOrgId),
          ))
          .limit(1);
        if (!entity) return { kind: "entity-404" as const };

        // Unique constraint: (project_id, entity_id)
        const [existing] = await db
          .select({ id: projectParticipantsTable.id })
          .from(projectParticipantsTable)
          .where(and(
            eq(projectParticipantsTable.projectId, ctx.projectId),
            eq(projectParticipantsTable.entityId, entityId),
          ))
          .limit(1);
        if (existing) return { kind: "dup" as const };

        const [row] = await db
          .insert(projectParticipantsTable)
          .values({
            projectId: ctx.projectId,
            entityId,
            role,
            notes: notes?.trim() || null,
          })
          .returning();
        return { kind: "ok" as const, row };
      });

      switch (outcome.kind) {
        case "proj-404": res.status(404).json({ error: "Project not found" }); return;
        case "entity-404": res.status(404).json({ error: "Entity not found in this organization" }); return;
        case "dup": res.status(409).json({ error: "Entity is already a participant in this project" }); return;
        default: res.status(201).json(outcome.row); return;
      }
    } catch (e) { next(e); }
  },
);

// ─── PUT /api/projects/:projectId/participants/:id ────────────────────────────

router.put(
  "/participants/:id",
  requireMinRole("admin"),
  parseBody(updateParticipantSchema),
  async (req: Request<ProjectParams>, res, next): Promise<void> => {
    const participantId = requireInt(req.params.id);
    const { role, notes } = req.body as z.infer<typeof updateParticipantSchema>;
    try {
      const outcome = await withTenant(async () => {
        const ctx = await resolveProjectOrg(req);
        if (!ctx) return { kind: "proj-404" as const };

        const [existing] = await db
          .select({ id: projectParticipantsTable.id })
          .from(projectParticipantsTable)
          .where(and(
            eq(projectParticipantsTable.id, participantId),
            eq(projectParticipantsTable.projectId, ctx.projectId),
          ))
          .limit(1);
        if (!existing) return { kind: "part-404" as const };

        const [updated] = await db
          .update(projectParticipantsTable)
          .set({
            ...(role  !== undefined && { role }),
            ...(notes !== undefined && { notes: notes?.trim() || null }),
            updatedAt: new Date(),
          })
          .where(eq(projectParticipantsTable.id, participantId))
          .returning();
        return { kind: "ok" as const, updated };
      });

      if (outcome.kind === "proj-404") { res.status(404).json({ error: "Project not found" }); return; }
      if (outcome.kind === "part-404") { res.status(404).json({ error: "Participant not found" }); return; }
      res.json(outcome.updated);
    } catch (e) { next(e); }
  },
);

// ─── DELETE /api/projects/:projectId/participants/:id ─────────────────────────

router.delete(
  "/participants/:id",
  requireMinRole("admin"),
  async (req: Request<ProjectParams>, res, next): Promise<void> => {
    const participantId = requireInt(req.params.id);
    try {
      const outcome = await withTenant(async () => {
        const ctx = await resolveProjectOrg(req);
        if (!ctx) return { kind: "proj-404" as const };

        const [existing] = await db
          .select({ id: projectParticipantsTable.id })
          .from(projectParticipantsTable)
          .where(and(
            eq(projectParticipantsTable.id, participantId),
            eq(projectParticipantsTable.projectId, ctx.projectId),
          ))
          .limit(1);
        if (!existing) return { kind: "part-404" as const };

        await db
          .delete(projectParticipantsTable)
          .where(eq(projectParticipantsTable.id, participantId));
        return { kind: "ok" as const };
      });

      if (outcome.kind === "proj-404") { res.status(404).json({ error: "Project not found" }); return; }
      if (outcome.kind === "part-404") { res.status(404).json({ error: "Participant not found" }); return; }
      res.json({ ok: true });
    } catch (e) { next(e); }
  },
);

export default router;
