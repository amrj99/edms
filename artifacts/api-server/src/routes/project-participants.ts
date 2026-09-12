import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import {
  projectParticipantsTable,
  projectsTable,
  entitiesTable,
  projectPartiesTable,
  participantRoleEnum,
} from "@workspace/db";
import { requireAuth } from "../lib/auth.js";
import { withTenant, tenantRead } from "../middlewares/tenant-scope.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { createAuditLog } from "../lib/audit.js";
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
  const result = await tenantRead(async () => {
    const ctx = await resolveProjectOrg(req);
    if (!ctx) return { kind: "notfound" as const };

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

    return { kind: "ok" as const, rows };
  });

  if (result.kind === "notfound") { res.status(404).json({ error: "Project not found" }); return; }
  res.json(result.rows);
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

        // Minimum Fix #2 — cross-org participants for a genuine multi-party project.
        // The participant LIST stays owner-managed (resolveProjectOrg above already
        // restricts this write to the project-owner org's admin, or system_owner —
        // a party org's admin cannot edit another company's participant list). The
        // ONLY relaxation is WHICH entity is acceptable: an entity belonging to
        //   (1) the project-owner org, OR
        //   (2) an org registered as an ACTIVE project_party on THIS project.
        // Entities of any org that is not the owner and not an active party are
        // rejected — no arbitrary cross-tenant entity. resolveCallerParticipant,
        // project_parties/project_participants models, and the chain are untouched.
        const [entity] = await db
          .select({ id: entitiesTable.id, organizationId: entitiesTable.organizationId })
          .from(entitiesTable)
          .where(eq(entitiesTable.id, entityId))
          .limit(1);
        if (!entity) return { kind: "entity-404" as const };

        let entityAllowed = entity.organizationId === ctx.projectOrgId;
        if (!entityAllowed && entity.organizationId != null) {
          const [party] = await db
            .select({ id: projectPartiesTable.id })
            .from(projectPartiesTable)
            .where(and(
              eq(projectPartiesTable.projectId, ctx.projectId),
              eq(projectPartiesTable.organizationId, entity.organizationId),
              isNull(projectPartiesTable.removedAt),
            ))
            .limit(1);
          entityAllowed = !!party;
        }
        if (!entityAllowed) return { kind: "entity-not-party" as const };

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

        await createAuditLog({
          userId: (req as any).user.id,
          organizationId: ctx.projectOrgId,
          action: "project_participant_added",
          entityType: "project_participant",
          entityId: row.id,
          projectId: ctx.projectId,
          details: {
            participantEntityId: entityId,
            participantOrgId: entity.organizationId,
            role,
            crossOrg: entity.organizationId !== ctx.projectOrgId,
          },
        });

        return { kind: "ok" as const, row };
      });

      switch (outcome.kind) {
        case "proj-404": res.status(404).json({ error: "Project not found" }); return;
        case "entity-404": res.status(404).json({ error: "Entity not found" }); return;
        case "entity-not-party": res.status(400).json({ error: "Entity's organization is neither the project owner nor an active party on this project" }); return;
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
