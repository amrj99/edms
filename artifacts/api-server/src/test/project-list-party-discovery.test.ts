/**
 * project-list-party-discovery.test.ts
 *
 * Integration tests for Phase 6C — Party Project Discovery.
 *
 * Covers the party branch of GET /api/projects (list) and the new
 * accessMode/partyRole fields on GET /api/projects/:id (detail).
 *
 * Invariant I-10: every project returned by the list must be openable via
 * the detail endpoint by the same user (list ⊆ detail-accessible). L10
 * asserts this by looping over each caller's list response.
 *
 * Fixture structure:
 *   orgOwner   — owns all projects (adminOwner: admin, memberOwner: member)
 *   orgParty   — active contributor party on projectMain (partyUser, partyUser2)
 *   orgObs     — active observer party on projectMain (obsUser)
 *   orgOther   — no relationship (otherUser)
 *
 * Projects (all owned by orgOwner):
 *   projectMain    — via API, collaborationMode='parties', both parties active
 *   projectOrgOnly — DB insert, collaborationMode='org_only' BUT with an active
 *                    party row for orgParty (stale-row scenario, L8)
 *   projectHidden  — DB insert, 'parties' + active party row for orgParty,
 *                    visibleOnFree=false (L9)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import {
  projectsTable,
  projectMembersTable,
  projectPartiesTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

const db = getTestDb();

let orgOwner: { id: number };
let orgParty: { id: number };
let orgObs:   { id: number };
let orgOther: { id: number };

let adminOwner:  { id: number };
let memberOwner: { id: number };
let partyUser:   { id: number };
let partyUser2:  { id: number };
let obsUser:     { id: number };
let otherUser:   { id: number };

let projectMainId:    number;
let projectOrgOnlyId: number;
let projectHiddenId:  number;

function listIds(body: any): number[] {
  const items = body.items ?? body;
  return (Array.isArray(items) ? items : []).map((p: any) => p.id);
}

function findProject(body: any, id: number): any {
  const items = body.items ?? body;
  return (Array.isArray(items) ? items : []).find((p: any) => p.id === id);
}

beforeAll(async () => {
  await truncateAllTables();

  orgOwner = await createOrg({ name: "Discovery Owner Org",    code: "DSCOWN" });
  orgParty = await createOrg({ name: "Discovery Party Org",    code: "DSCPTY" });
  orgObs   = await createOrg({ name: "Discovery Observer Org", code: "DSCOBS" });
  orgOther = await createOrg({ name: "Discovery Other Org",    code: "DSCOTH" });

  adminOwner  = await createUser({ organizationId: orgOwner.id, role: "admin",  email: "admin@dscown.test" });
  memberOwner = await createUser({ organizationId: orgOwner.id, role: "member", email: "member@dscown.test" });
  partyUser   = await createUser({ organizationId: orgParty.id, role: "member", email: "p1@dscpty.test" });
  partyUser2  = await createUser({ organizationId: orgParty.id, role: "member", email: "p2@dscpty.test" });
  obsUser     = await createUser({ organizationId: orgObs.id,   role: "member", email: "o1@dscobs.test" });
  otherUser   = await createUser({ organizationId: orgOther.id, role: "member", email: "x1@dscoth.test" });

  // projectMain via API (parties mode, two active parties)
  const pRes = await api()
    .post("/api/projects")
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ name: "Discovery Main Project", code: "DSCPRJ" });
  expect(pRes.status).toBe(201);
  projectMainId = pRes.body.id;

  const modeRes = await api()
    .patch(`/api/projects/${projectMainId}/collaboration-mode`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ collaborationMode: "parties" });
  expect(modeRes.status).toBe(200);

  const c1 = await api()
    .post(`/api/projects/${projectMainId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgParty.id, partyRole: "contributor" });
  expect(c1.status).toBe(201);

  const c2 = await api()
    .post(`/api/projects/${projectMainId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgObs.id, partyRole: "observer" });
  expect(c2.status).toBe(201);

  // memberOwner is an explicit member of projectMain only (L2)
  await db.insert(projectMembersTable).values({
    projectId: projectMainId,
    userId: memberOwner.id,
    role: "member",
  });

  // projectOrgOnly — org_only with a STALE active party row for orgParty (L8).
  // DB inserts bypass API plan limits; the stale-row state itself is what L8 tests.
  const [pB] = await db.insert(projectsTable).values({
    name: "Discovery OrgOnly Project",
    code: "DSCB01",
    organizationId: orgOwner.id,
    status: "active",
    collaborationMode: "org_only",
  }).returning({ id: projectsTable.id });
  projectOrgOnlyId = pB.id;
  await db.insert(projectPartiesTable).values({
    projectId: projectOrgOnlyId,
    organizationId: orgParty.id,
    partyRole: "contributor",
    addedById: adminOwner.id,
  });

  // projectHidden — parties mode + active party, but visibleOnFree=false (L9)
  const [pC] = await db.insert(projectsTable).values({
    name: "Discovery Hidden Project",
    code: "DSCC01",
    organizationId: orgOwner.id,
    status: "active",
    collaborationMode: "parties",
    visibleOnFree: false,
  }).returning({ id: projectsTable.id });
  projectHiddenId = pC.id;
  await db.insert(projectPartiesTable).values({
    projectId: projectHiddenId,
    organizationId: orgParty.id,
    partyRole: "contributor",
    addedById: adminOwner.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
});

describe("Phase 6C — GET /api/projects party discovery", () => {

  it("L1: owner admin sees all own-org projects with accessMode=intra_org (regression)", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("admin", adminOwner.id, orgOwner.id));
    expect(res.status).toBe(200);
    const ids = listIds(res.body);
    expect(res.body).not.toHaveProperty("projects"); // P2-a flip
    expect(ids).toContain(projectMainId);
    expect(ids).toContain(projectOrgOnlyId);
    const main = findProject(res.body, projectMainId);
    expect(main.accessMode).toBe("intra_org");
    expect(main.partyRole).toBeUndefined();
  });

  it("L2: owner non-admin member sees only membership projects (regression)", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", memberOwner.id, orgOwner.id));
    expect(res.status).toBe(200);
    const ids = listIds(res.body);
    expect(ids).toContain(projectMainId);
    expect(ids).not.toContain(projectOrgOnlyId);
  });

  it("L3: party contributor sees the party project with accessMode=party, partyRole=contributor", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).toContain(projectMainId);
    const main = findProject(res.body, projectMainId);
    expect(main.accessMode).toBe("party");
    expect(main.partyRole).toBe("contributor");
  });

  it("L4: party observer sees the party project with partyRole=observer", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", obsUser.id, orgObs.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).toContain(projectMainId);
    const main = findProject(res.body, projectMainId);
    expect(main.accessMode).toBe("party");
    expect(main.partyRole).toBe("observer");
  });

  it("L5: any non-admin user of the party org sees the party project (org-wide parity with canAccessProject)", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", partyUser2.id, orgParty.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).toContain(projectMainId);
  });

  it("L6: revoked party loses the project from the list immediately", async () => {
    await db.update(projectPartiesTable)
      .set({ removedAt: new Date() })
      .where(and(
        eq(projectPartiesTable.projectId, projectMainId),
        eq(projectPartiesTable.organizationId, orgParty.id),
        isNull(projectPartiesTable.removedAt),
      ));

    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).not.toContain(projectMainId);

    // Restore for subsequent tests
    await db.update(projectPartiesTable)
      .set({ removedAt: null })
      .where(and(
        eq(projectPartiesTable.projectId, projectMainId),
        eq(projectPartiesTable.organizationId, orgParty.id),
      ));
  });

  it("L7: unrelated cross-org user never sees the project", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", otherUser.id, orgOther.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).not.toContain(projectMainId);
    expect(listIds(res.body)).not.toContain(projectOrgOnlyId);
    expect(listIds(res.body)).not.toContain(projectHiddenId);
  });

  it("L8: org_only project with a stale active party row stays hidden from the party", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).not.toContain(projectOrgOnlyId);

    // The detail gate agrees: canAccessProject denies org_only for non-owner orgs
    const detail = await api()
      .get(`/api/projects/${projectOrgOnlyId}`)
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(detail.status).toBe(403);
  });

  it("L9: visibleOnFree=false party project is hidden from the party list", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(res.status).toBe(200);
    expect(listIds(res.body)).not.toContain(projectHiddenId);
  });

  it("L10: Invariant I-10 — every listed project opens via detail for the same user", async () => {
    const callers = [
      { name: "adminOwner",  header: authHeader("admin",  adminOwner.id,  orgOwner.id) },
      { name: "memberOwner", header: authHeader("member", memberOwner.id, orgOwner.id) },
      { name: "partyUser",   header: authHeader("member", partyUser.id,   orgParty.id) },
      { name: "obsUser",     header: authHeader("member", obsUser.id,     orgObs.id) },
      { name: "otherUser",   header: authHeader("member", otherUser.id,   orgOther.id) },
    ];
    for (const caller of callers) {
      const list = await api().get("/api/projects").set(caller.header);
      expect(list.status).toBe(200);
      for (const id of listIds(list.body)) {
        const detail = await api().get(`/api/projects/${id}`).set(caller.header);
        expect(
          detail.status,
          `I-10 violated: ${caller.name} sees project ${id} in list but detail returned ${detail.status}`,
        ).toBe(200);
      }
    }
  });

  it("L11: GET /:id returns accessMode/partyRole consistent with the list", async () => {
    const asParty = await api()
      .get(`/api/projects/${projectMainId}`)
      .set(authHeader("member", partyUser.id, orgParty.id));
    expect(asParty.status).toBe(200);
    expect(asParty.body.accessMode).toBe("party");
    expect(asParty.body.partyRole).toBe("contributor");

    const asOwner = await api()
      .get(`/api/projects/${projectMainId}`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.accessMode).toBe("intra_org");
    expect(asOwner.body.partyRole).toBeUndefined();
  });

});
