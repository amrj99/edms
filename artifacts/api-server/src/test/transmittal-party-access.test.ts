/**
 * transmittal-party-access.test.ts
 *
 * Integration tests for Phase 6B — Cross-Org Transmittal Read Access.
 *
 * Covers PARTY_CEILING_V1 extensions (read_transmittal, acknowledge_transmittal),
 * the three-gate model on POST /:id/acknowledge, and Invariant I-9 (list and
 * detail use the same transmittalPartyFilter predicate).
 *
 * Fixture structure:
 *   orgOwner       — project owner, creates and sends transmittals
 *   orgContributor — party contributor (sends and receives transmittals)
 *   orgObserver    — party observer (read-only transmittal access)
 *   orgOther       — no party relationship
 *
 *   adminOwner         — admin in orgOwner
 *   memberContributor  — member in orgContributor (toUserId on trsToContributor)
 *   otherContributor   — member in orgContributor (same org, NOT toUserId)
 *   memberObserver     — member in orgObserver (toUserId on trsToObserver)
 *   memberOther        — member in orgOther (no project access)
 *
 * Transmittals (all in projectMain unless noted):
 *   trsToContributor — sender=orgOwner, toUserId=memberContributor
 *   trsToObserver    — sender=orgOwner, toUserId=memberObserver
 *   trsInternal      — sender=orgOwner, toUserId=adminOwner (intra-org, no party sees it)
 *   trsInProjectB    — in projectB (separate project, for P13 information-hiding test)
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
  transmittalsTable,
  projectPartiesTable,
  projectsTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

const db = getTestDb();

// ─── Fixture state ────────────────────────────────────────────────────────────

let orgOwner:       { id: number };
let orgContributor: { id: number };
let orgObserver:    { id: number };
let orgOther:       { id: number };

let adminOwner:        { id: number; organizationId: number | null };
let memberContributor: { id: number; organizationId: number | null };
let otherContributor:  { id: number; organizationId: number | null };
let memberObserver:    { id: number; organizationId: number | null };
let memberOther:       { id: number; organizationId: number | null };

let projectMainId: number;
let projectBId:    number;

let trsIdToContributor: number;
let trsIdToObserver:    number;
let trsIdInternal:      number;
let trsIdInProjectB:    number;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();

  // Orgs
  orgOwner       = await createOrg({ name: "Party Owner Org",       code: "PTYOWN" });
  orgContributor = await createOrg({ name: "Party Contributor Org", code: "PTYCNT" });
  orgObserver    = await createOrg({ name: "Party Observer Org",    code: "PTYOBS" });
  orgOther       = await createOrg({ name: "Party Other Org",       code: "PTYOTH" });

  // Users
  adminOwner        = await createUser({ organizationId: orgOwner.id,       role: "admin",  email: "admin@ptyown.test" });
  memberContributor = await createUser({ organizationId: orgContributor.id, role: "member", email: "contrib@ptycnt.test" });
  otherContributor  = await createUser({ organizationId: orgContributor.id, role: "member", email: "other@ptycnt.test" });
  memberObserver    = await createUser({ organizationId: orgObserver.id,    role: "member", email: "obs@ptyobs.test" });
  memberOther       = await createUser({ organizationId: orgOther.id,       role: "member", email: "other@ptyoth.test" });

  // Org configs (requireModule("registers") check)
  await db.insert(orgConfigTable).values([
    { organizationId: orgOwner.id,       modules: { registers: true } },
    { organizationId: orgContributor.id, modules: { registers: true } },
    { organizationId: orgObserver.id,    modules: { registers: true } },
    { organizationId: orgOther.id,       modules: { registers: true } },
  ]);

  // Project Main (via API so collaboration-mode + parties are wired correctly)
  const pRes = await api()
    .post("/api/projects")
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ name: "Party Access Project", code: "PTYPRJ" });
  expect(pRes.status).toBe(201);
  projectMainId = pRes.body.id;

  // Enable parties mode
  const modeRes = await api()
    .patch(`/api/projects/${projectMainId}/collaboration-mode`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ collaborationMode: "parties" });
  expect(modeRes.status).toBe(200);

  // Add orgContributor as contributor
  const c1Res = await api()
    .post(`/api/projects/${projectMainId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgContributor.id, partyRole: "contributor" });
  expect(c1Res.status).toBe(201);

  // Add orgObserver as observer
  const c2Res = await api()
    .post(`/api/projects/${projectMainId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgObserver.id, partyRole: "observer" });
  expect(c2Res.status).toBe(201);

  // Project B (separate project — for P13 information-hiding test).
  // Inserted directly to bypass plan-limit checks in the API that don't apply
  // to the information-hiding scenario being tested.
  const [projB] = await db.insert(projectsTable).values({
    name: "Party Other Project",
    code: "PTYB01",
    organizationId: orgOwner.id,
    status: "active",
  }).returning({ id: projectsTable.id });
  projectBId = projB.id;

  // Transmittals via DB insert (faster, avoids dependency on send/draft flow)
  const now = new Date();

  const [t1] = await db.insert(transmittalsTable).values({
    transmittalNumber: "TRS-PTYPRJ-0001",
    subject: "To Contributor",
    purpose: "for_information",
    projectId: projectMainId,
    organizationId: orgOwner.id,
    createdById: adminOwner.id,
    toUserId: memberContributor.id,
    status: "sent",
  }).returning({ id: transmittalsTable.id });
  trsIdToContributor = t1.id;

  const [t2] = await db.insert(transmittalsTable).values({
    transmittalNumber: "TRS-PTYPRJ-0002",
    subject: "To Observer",
    purpose: "for_information",
    projectId: projectMainId,
    organizationId: orgOwner.id,
    createdById: adminOwner.id,
    toUserId: memberObserver.id,
    status: "sent",
  }).returning({ id: transmittalsTable.id });
  trsIdToObserver = t2.id;

  const [t3] = await db.insert(transmittalsTable).values({
    transmittalNumber: "TRS-PTYPRJ-0003",
    subject: "Internal to Admin",
    purpose: "for_information",
    projectId: projectMainId,
    organizationId: orgOwner.id,
    createdById: adminOwner.id,
    toUserId: adminOwner.id,
    status: "sent",
  }).returning({ id: transmittalsTable.id });
  trsIdInternal = t3.id;

  const [t4] = await db.insert(transmittalsTable).values({
    transmittalNumber: "TRS-PTYB01-0001",
    subject: "In Project B",
    purpose: "for_information",
    projectId: projectBId,
    organizationId: orgOwner.id,
    createdById: adminOwner.id,
    status: "draft",
  }).returning({ id: transmittalsTable.id });
  trsIdInProjectB = t4.id;
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 6B — Party transmittal read access", () => {

  // P1 — contributor list
  it("P1: contributor (recipient org) can list transmittals and sees their transmittal", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map(t => t.id);
    expect(ids).toContain(trsIdToContributor);
    expect(ids).not.toContain(trsIdInternal);
  });

  // P2 — contributor named recipient detail
  it("P2: contributor (named toUserId) can GET transmittal detail", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals/${trsIdToContributor}`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(trsIdToContributor);
  });

  // P3 — org-level access (same recipient org, not toUserId)
  it("P3: other contributor (same org, not toUserId) can GET transmittal detail via org-level access", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals/${trsIdToContributor}`)
      .set(authHeader("member", otherContributor.id, orgContributor.id));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(trsIdToContributor);
  });

  // P4 — contributor cannot see transmittal addressed to a different org
  it("P4: contributor cannot GET transmittal addressed to a different org → 404", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals/${trsIdInternal}`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(404);
  });

  // P5 — observer can list (read_transmittal in observer ceiling)
  it("P5: observer can list transmittals → 200 (read_transmittal in ceiling)", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals`)
      .set(authHeader("member", memberObserver.id, orgObserver.id));
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map(t => t.id);
    expect(ids).toContain(trsIdToObserver);
    expect(ids).not.toContain(trsIdToContributor);
  });

  // P6 — observer can view detail of transmittal addressed to them
  it("P6: observer can GET transmittal detail (addressed to their org) → 200", async () => {
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals/${trsIdToObserver}`)
      .set(authHeader("member", memberObserver.id, orgObserver.id));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(trsIdToObserver);
  });

  // P7 — observer cannot acknowledge (acknowledge_transmittal not in observer ceiling)
  it("P7: observer cannot acknowledge a transmittal → 403 (ceiling)", async () => {
    const res = await api()
      .post(`/api/projects/${projectMainId}/transmittals/${trsIdToObserver}/acknowledge`)
      .set(authHeader("member", memberObserver.id, orgObserver.id));
    expect(res.status).toBe(403);
  });

  // P8 — contributor (recipient) can acknowledge
  it("P8: contributor (recipient org) can acknowledge their transmittal → 200", async () => {
    const res = await api()
      .post(`/api/projects/${projectMainId}/transmittals/${trsIdToContributor}/acknowledge`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  // P9 — contributor from sender org (not recipient) cannot acknowledge
  it("P9: contributor (sender org, not recipient org) cannot acknowledge → 403 (Gate 3)", async () => {
    // trsIdToObserver is sent by orgOwner (intra-org) to orgObserver.
    // orgContributor is neither sender nor recipient → Gate 3 fails.
    const res = await api()
      .post(`/api/projects/${projectMainId}/transmittals/${trsIdToObserver}/acknowledge`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(403);
  });

  // P10 — contributor cannot send a transmittal (requireRole blocks DC-level actions)
  it("P10: contributor cannot send a transmittal → 403 (role gate)", async () => {
    const res = await api()
      .post(`/api/projects/${projectMainId}/transmittals/${trsIdToContributor}/send`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(403);
  });

  // P11 — contributor cannot complete-review (assignment check blocks it)
  it("P11: contributor cannot complete-review → 403", async () => {
    const res = await api()
      .post(`/api/projects/${projectMainId}/transmittals/${trsIdToContributor}/complete-review`)
      .set(authHeader("member", memberContributor.id, orgContributor.id))
      .send({ reviewComment: "party attempt" });
    expect(res.status).toBe(403);
  });

  // P12 — revoked party loses access immediately (T-6)
  it("P12: revoked contributor cannot list transmittals → 403 (T-6: canAccessProject blocks)", async () => {
    // Revoke by setting removed_at
    await db.update(projectPartiesTable)
      .set({ removedAt: new Date() })
      .where(and(
        eq(projectPartiesTable.projectId, projectMainId),
        eq(projectPartiesTable.organizationId, orgObserver.id),
        isNull(projectPartiesTable.removedAt),
      ));

    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals`)
      .set(authHeader("member", memberObserver.id, orgObserver.id));
    expect(res.status).toBe(403);

    // Restore
    await db.update(projectPartiesTable)
      .set({ removedAt: null })
      .where(and(
        eq(projectPartiesTable.projectId, projectMainId),
        eq(projectPartiesTable.organizationId, orgObserver.id),
      ));
  });

  // P13 — information hiding: transmittal from a different project → 404
  it("P13: transmittal from a different project returns 404, not 403 (information hiding)", async () => {
    // memberContributor is a party in projectMainId.
    // trsIdInProjectB belongs to projectBId (they have no access to projectB).
    // Calling via projectMainId URL: filter has project_id=projectMainId, trsInProjectB has project_id=projectBId → no match.
    const res = await api()
      .get(`/api/projects/${projectMainId}/transmittals/${trsIdInProjectB}`)
      .set(authHeader("member", memberContributor.id, orgContributor.id));
    expect(res.status).toBe(404);
  });

});
