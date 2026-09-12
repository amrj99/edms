/**
 * project-participants-cross-org.test.ts — Minimum Fix #2.
 *
 * POST /api/projects/:id/participants now accepts an entity that belongs to
 *   (1) the project-owner org, OR
 *   (2) an org registered as an ACTIVE project_party on this project.
 * Any other org's entity is rejected. The participant LIST stays owner-managed:
 * only the project-owner org's admin (or system_owner) may POST — a party org's
 * admin cannot edit another company's participant list.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { entitiesTable, projectPartiesTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const db = getTestDb();

let orgOwner: { id: number }, orgParty: { id: number }, orgRemoved: { id: number }, orgOutsider: { id: number };
let adminOwner: Awaited<ReturnType<typeof createUser>>;
let adminParty: Awaited<ReturnType<typeof createUser>>;
let project: { id: number }, project2: { id: number };
let eOwner: number, eParty: number, eRemoved: number, eOutsider: number;

async function mkEntity(orgId: number, name: string): Promise<number> {
  const [e] = await db.insert(entitiesTable).values({ organizationId: orgId, name, type: "company" }).returning();
  return e.id;
}

beforeAll(async () => {
  await truncateAllTables();
  orgOwner    = await createOrg({ name: "PP Owner Org", code: "PPOWN" });
  orgParty    = await createOrg({ name: "PP Party Org", code: "PPPTY" });
  orgRemoved  = await createOrg({ name: "PP Removed Party Org", code: "PPRMV" });
  orgOutsider = await createOrg({ name: "PP Outsider Org", code: "PPOUT" });
  adminOwner = await createUser({ organizationId: orgOwner.id, role: "admin", email: "pp-owner@t.edms" });
  adminParty = await createUser({ organizationId: orgParty.id, role: "admin", email: "pp-party@t.edms" });

  project  = await createProject({ organizationId: orgOwner.id, code: "PPPRJ1" });
  project2 = await createProject({ organizationId: orgOwner.id, code: "PPPRJ2" });

  eOwner    = await mkEntity(orgOwner.id, "Owner Entity");
  eParty    = await mkEntity(orgParty.id, "Party Entity");
  eRemoved  = await mkEntity(orgRemoved.id, "Removed Party Entity");
  eOutsider = await mkEntity(orgOutsider.id, "Outsider Entity");

  // project1: orgParty is an ACTIVE party; orgRemoved is a REMOVED party.
  await db.insert(projectPartiesTable).values([
    { projectId: project.id, organizationId: orgParty.id,   partyRole: "contributor", addedById: adminOwner.id },
    { projectId: project.id, organizationId: orgRemoved.id, partyRole: "contributor", addedById: adminOwner.id, removedAt: new Date() },
  ]);
  // project2: NO parties (used for the cross-project rejection test).
});

const hdrOwner = () => authHeader("admin", adminOwner.id, orgOwner.id, "pp-owner@t.edms");

describe("POST /participants — cross-org (Minimum Fix #2)", () => {
  it("entity of the project-owner org → 201", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: eOwner, role: "sub_contractor" });
    expect(r.status).toBe(201);
    expect(r.body.entityId).toBe(eOwner);
  });

  it("entity of an ACTIVE party org → 201, and audit written (crossOrg)", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: eParty, role: "consultant" });
    expect(r.status).toBe(201);
    expect(r.body.entityId).toBe(eParty);
    const audit = await db.select().from(auditLogsTable)
      .where(and(eq(auditLogsTable.action, "project_participant_added"), eq(auditLogsTable.entityId, r.body.id)));
    expect(audit.length).toBe(1);
    expect((audit[0].details as any).crossOrg).toBe(true);
  });

  it("entity of a non-party org → 400 (rejected)", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: eOutsider, role: "supplier" });
    expect(r.status).toBe(400);
  });

  it("entity of a REMOVED (inactive) party org → 400 (rejected)", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: eRemoved, role: "other" });
    expect(r.status).toBe(400);
  });

  it("cross-project: a party on project1 is NOT a party on project2 → 400", async () => {
    const r = await api().post(`/api/projects/${project2.id}/participants`).set(hdrOwner())
      .send({ entityId: eParty, role: "consultant" });
    expect(r.status).toBe(400);
  });

  it("party-org admin CANNOT manage another org's participant list → 404 (owner-managed)", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`)
      .set(authHeader("admin", adminParty.id, orgParty.id, "pp-party@t.edms"))
      .send({ entityId: eParty, role: "consultant" });
    expect(r.status).toBe(404); // resolveProjectOrg: not owner org, not system_owner → out of tenant scope
  });

  it("duplicate participant → 409 (no duplicate created)", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: eParty, role: "consultant" });
    expect(r.status).toBe(409);
  });

  it("entity that does not exist → 404", async () => {
    const r = await api().post(`/api/projects/${project.id}/participants`).set(hdrOwner())
      .send({ entityId: 99999999, role: "other" });
    expect(r.status).toBe(404);
  });
});
