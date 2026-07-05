import { Router } from "express";
import type { Request } from "express";
import {
  db,
  projectsTable,
  projectPartiesTable,
  organizationsTable,
  usersTable,
  PARTY_ROLES,
  COLLABORATION_MODES,
} from "@workspace/db";
import { eq, and, isNull, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireMinRole } from "../middlewares/require-role.js";
import { parseBody } from "../lib/validate.js";
import { requireInt, type ProjectParams } from "../lib/params.js";
import { z } from "zod";

const router = Router({ mergeParams: true });

router.use(requireAuth);

// ─── Params ───────────────────────────────────────────────────────────────────

interface PartyOrgParams extends ProjectParams {
  orgId: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const addPartySchema = z.object({
  organizationId: z.number().int().positive(),
  partyRole:      z.enum(PARTY_ROLES),
});

const collaborationModeSchema = z.object({
  collaborationMode: z.enum(COLLABORATION_MODES),
});

// ─── Helper: resolve project, enforce owner-org gate ─────────────────────────
//
// Party members see a 404 (not 403) — same information-hiding pattern as
// project-participants. Only the owner org's users (+ system_owner) may manage
// a project's party list.

async function resolveOwnerProject(
  req: Request<ProjectParams>,
  res: any,
): Promise<{ projectId: number; projectOrgId: number } | null> {
  const projectId = requireInt(req.params.projectId);
  const caller = (req as any).user;

  const [project] = await db
    .select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }

  const projectOrgId = project.organizationId;

  if (caller.role !== "system_owner" && caller.organizationId !== projectOrgId) {
    res.status(404).json({ error: "Project not found" }); return null;
  }

  return { projectId, projectOrgId };
}

// ─── GET /api/projects/:projectId/available-organizations ────────────────────
// Returns all organizations that can be added as parties to this project.
// Excludes: (1) the project owner org, (2) already-active parties.
// Gate: same as /parties — only owner-org users (+ system_owner) can call this.

router.get("/available-organizations", async (req: Request<ProjectParams>, res): Promise<void> => {
  const ctx = await resolveOwnerProject(req, res);
  if (!ctx) return;

  const activeParties = await db
    .select({ organizationId: projectPartiesTable.organizationId })
    .from(projectPartiesTable)
    .where(and(
      eq(projectPartiesTable.projectId, ctx.projectId),
      isNull(projectPartiesTable.removedAt),
    ));

  const excludeIds = new Set([ctx.projectOrgId, ...activeParties.map(r => r.organizationId)]);

  const all = await db
    .select({
      id:   organizationsTable.id,
      name: organizationsTable.name,
      code: organizationsTable.code,
      type: organizationsTable.type,
    })
    .from(organizationsTable)
    .orderBy(organizationsTable.name);

  res.json(all.filter(o => !excludeIds.has(o.id)));
});

// ─── GET /api/projects/:projectId/parties ─────────────────────────────────────
// Returns active (non-removed) parties with org name and addedBy user.

router.get("/parties", async (req: Request<ProjectParams>, res): Promise<void> => {
  const ctx = await resolveOwnerProject(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id:        projectPartiesTable.id,
      partyRole: projectPartiesTable.partyRole,
      addedAt:   projectPartiesTable.addedAt,
      organization: {
        id:   organizationsTable.id,
        name: organizationsTable.name,
      },
      addedBy: {
        id:        usersTable.id,
        firstName: usersTable.firstName,
        lastName:  usersTable.lastName,
      },
    })
    .from(projectPartiesTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectPartiesTable.organizationId))
    .innerJoin(usersTable, eq(usersTable.id, projectPartiesTable.addedById))
    .where(and(
      eq(projectPartiesTable.projectId, ctx.projectId),
      isNull(projectPartiesTable.removedAt),
    ))
    .orderBy(organizationsTable.name);

  res.json(rows);
});

// ─── POST /api/projects/:projectId/parties ────────────────────────────────────
// Adds an organization as a party to the project.
//
// Does NOT change collaborationMode — that is a separate toggle. Parties can
// be pre-provisioned before activating party mode on the project.
//
// If the org was previously removed (soft-deleted), it is re-activated with a
// fresh addedAt / addedById and the new partyRole.

router.post(
  "/parties",
  requireMinRole("admin"),
  parseBody(addPartySchema),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const ctx = await resolveOwnerProject(req, res);
    if (!ctx) return;

    const { organizationId, partyRole } = req.body as z.infer<typeof addPartySchema>;
    const caller = (req as any).user;

    // Owner org cannot be added as its own party
    if (organizationId === ctx.projectOrgId) {
      res.status(422).json({ error: "The project owner organization cannot be added as a party" });
      return;
    }

    // Verify target org exists
    const [org] = await db
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1);

    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

    // Check for existing record (active or previously soft-deleted)
    const [existing] = await db
      .select({ id: projectPartiesTable.id, removedAt: projectPartiesTable.removedAt })
      .from(projectPartiesTable)
      .where(and(
        eq(projectPartiesTable.projectId, ctx.projectId),
        eq(projectPartiesTable.organizationId, organizationId),
      ))
      .limit(1);

    if (existing && !existing.removedAt) {
      res.status(409).json({ error: "Organization is already an active party to this project" });
      return;
    }

    let row;

    if (existing) {
      // Re-activate a previously removed party — treat as a fresh addition
      [row] = await db
        .update(projectPartiesTable)
        .set({
          partyRole,
          addedById:   caller.id,
          addedAt:     new Date(),
          removedAt:   null,
          removedById: null,
        })
        .where(eq(projectPartiesTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(projectPartiesTable)
        .values({
          projectId: ctx.projectId,
          organizationId,
          partyRole,
          addedById: caller.id,
        })
        .returning();
    }

    res.status(201).json(row);
  },
);

// ─── DELETE /api/projects/:projectId/parties/:orgId ──────────────────────────
// Soft-deletes a party record. Sets removed_at + removed_by_id for audit trail.
//
// The resolveOwnerProject guard already prevents party-org users from reaching
// this endpoint (they receive a 404). The endpoint is owner-org admin only.

router.delete(
  "/parties/:orgId",
  requireMinRole("admin"),
  async (req: Request<PartyOrgParams>, res): Promise<void> => {
    const ctx = await resolveOwnerProject(req as unknown as Request<ProjectParams>, res);
    if (!ctx) return;

    const orgId = requireInt(req.params.orgId, "orgId");
    const caller = (req as any).user;

    const [party] = await db
      .select({ id: projectPartiesTable.id })
      .from(projectPartiesTable)
      .where(and(
        eq(projectPartiesTable.projectId, ctx.projectId),
        eq(projectPartiesTable.organizationId, orgId),
        isNull(projectPartiesTable.removedAt),
      ))
      .limit(1);

    if (!party) { res.status(404).json({ error: "Active party not found" }); return; }

    await db
      .update(projectPartiesTable)
      .set({ removedAt: new Date(), removedById: caller.id })
      .where(eq(projectPartiesTable.id, party.id));

    res.json({ ok: true });
  },
);

// ─── PATCH /api/projects/:projectId/collaboration-mode ────────────────────────
// Sets the project's collaboration mode. Does not add, remove, or modify any
// party records — it only opens or closes the authorization gate in
// canAccessProject() / canAccessProjectAsParty().
//
// Switching to "org_only": existing party records are preserved; party members
// simply lose access until mode is switched back to "parties".
// Switching to "parties":  no parties are auto-added; only orgs already present
// in project_parties (with removed_at IS NULL) gain access.

router.patch(
  "/collaboration-mode",
  requireMinRole("admin"),
  parseBody(collaborationModeSchema),
  async (req: Request<ProjectParams>, res): Promise<void> => {
    const ctx = await resolveOwnerProject(req, res);
    if (!ctx) return;

    const { collaborationMode } = req.body as z.infer<typeof collaborationModeSchema>;

    await db
      .update(projectsTable)
      .set({ collaborationMode })
      .where(eq(projectsTable.id, ctx.projectId));

    res.json({ projectId: ctx.projectId, collaborationMode });
  },
);

export default router;
