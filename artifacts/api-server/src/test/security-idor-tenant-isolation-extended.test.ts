/**
 * security-idor-tenant-isolation-extended.test.ts  (DEBT-009 — full resource sweep)
 *
 * Extends the core IDOR regression to every remaining resource type flagged by the
 * Final Security Review. For each: a tenant admin of org A must NOT reach org B
 * (403/404), own-tenant still works, a client-supplied ?orgId cannot re-scope,
 * lower roles get no escalation, system_owner keeps global scope, and for
 * WRITE/DELETE/ACCOUNT the rejected op must NOT have changed any data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import {
  entitiesTable, contactsTable, departmentsTable, userDepartmentsTable,
  meetingsTable, correspondenceTable, documentsTable, transmittalsTable, projectMembersTable,
  orgConfigTable,
} from "@workspace/db";

const ALL_MODULES = {
  dashboard: true, deliverables: true, registers: true, notifications: true,
  workflow_engine: true, meetings: true, correspondence: true, chat: true,
};

interface Fx {
  orgA: { id: number }; orgB: { id: number };
  adminA: { id: number }; viewerA: { id: number }; adminB: { id: number }; sysOwner: { id: number };
  projectA: { id: number }; projectB: { id: number };
  entityA: { id: number }; entityB: { id: number };
  deptA: { id: number }; deptB: { id: number };
  meetingB: { id: number };
  corrB: { id: number };
  docB: { id: number };
  transmittalB: { id: number };
}
let fx: Fx;
const db = () => getTestDb();
const hAdminA  = () => authHeader("admin", fx.adminA.id, fx.orgA.id, "a@a.test");
const hViewerA = () => authHeader("viewer", fx.viewerA.id, fx.orgA.id, "v@a.test");
const hOwner   = () => authHeader("system_owner", fx.sysOwner.id, fx.orgA.id, "o@p.test");
const blocked = (s: number) => [403, 404].includes(s);

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "X Org A", code: "IDXA" });
  const orgB = await createOrg({ name: "X Org B", code: "IDXB" });
  const adminA  = await createUser({ organizationId: orgA.id, role: "admin",        email: "a@a.test" });
  const viewerA = await createUser({ organizationId: orgA.id, role: "viewer",       email: "v@a.test" });
  const adminB  = await createUser({ organizationId: orgB.id, role: "admin",        email: "a@b.test" });
  const sysOwner = await createUser({ organizationId: orgA.id, role: "system_owner", email: "o@p.test" });
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: ALL_MODULES },
    { organizationId: orgB.id, modules: ALL_MODULES },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: adminA.id, name: "PA", code: "IDXA-1" });
  const projectB = await createProject({ organizationId: orgB.id, createdById: adminB.id, name: "PB", code: "IDXB-1" });
  await db().insert(projectMembersTable).values([
    { projectId: projectA.id, userId: adminA.id, role: "admin" },
    { projectId: projectB.id, userId: adminB.id, role: "admin" },
  ]);
  const [entityA] = await db().insert(entitiesTable).values({ organizationId: orgA.id, name: "EA", type: "company" }).returning();
  const [entityB] = await db().insert(entitiesTable).values({ organizationId: orgB.id, name: "EB", type: "company" }).returning();
  await db().insert(contactsTable).values({ entityId: entityB.id, name: "CB", email: "cb@b.test" });
  const [deptA] = await db().insert(departmentsTable).values({ organizationId: orgA.id, code: "da", name: "Dept A" }).returning();
  const [deptB] = await db().insert(departmentsTable).values({ organizationId: orgB.id, code: "db", name: "Dept B" }).returning();
  await db().insert(userDepartmentsTable).values({ userId: adminB.id, departmentId: deptB.id });
  const [meetingB] = await db().insert(meetingsTable).values({
    title: "MB", organizationId: orgB.id, organizedById: adminB.id, status: "scheduled", meetingDate: new Date(),
  }).returning();
  const [corrB] = await db().insert(correspondenceTable).values({
    subject: "CB", type: "letter", folder: "inbox", body: "x", fromUserId: adminB.id, organizationId: orgB.id, projectId: null,
  }).returning();
  const [docB] = await db().insert(documentsTable).values({
    documentNumber: "B-DOC-001", title: "Doc B", projectId: projectB.id, createdById: adminB.id, revision: "A", organizationId: orgB.id,
  }).returning();
  const [transmittalB] = await db().insert(transmittalsTable).values({
    transmittalNumber: "B-TR-001", subject: "TR B", projectId: projectB.id, createdById: adminB.id,
  }).returning();

  fx = { orgA, orgB, adminA, viewerA, adminB, sysOwner, projectA, projectB, entityA, entityB, deptA, deptB, meetingB, corrB, docB, transmittalB };
});
afterAll(async () => { await truncateAllTables(); });

describe("DEBT-009 extended — entities/contacts", () => {
  it("adminA cannot read org B entity", async () => expect(blocked((await api().get(`/api/entities/${fx.entityB.id}`).set(hAdminA())).status)).toBe(true));
  it("adminA cannot read org B entity contacts", async () => expect(blocked((await api().get(`/api/entities/${fx.entityB.id}/contacts`).set(hAdminA())).status)).toBe(true));
  it("spoofed ?orgId cannot re-scope entity read", async () => expect(blocked((await api().get(`/api/entities/${fx.entityB.id}?orgId=${fx.orgB.id}`).set(hAdminA())).status)).toBe(true));
  it("adminA CAN read own org entity", async () => expect((await api().get(`/api/entities/${fx.entityA.id}`).set(hAdminA())).status).toBe(200));
  it("WRITE rejected leaves data unchanged: adminA PUT org B entity", async () => {
    const r = await api().put(`/api/entities/${fx.entityB.id}`).set(hAdminA()).send({ name: "HIJACKED" });
    expect(blocked(r.status)).toBe(true);
    const [row] = await db().select().from(entitiesTable).where(eq(entitiesTable.id, fx.entityB.id));
    expect(row.name).toBe("EB");
  });
});

describe("DEBT-009 extended — departments + members (ACCOUNT)", () => {
  it("adminA cannot read org B dept members", async () => expect(blocked((await api().get(`/api/departments/${fx.deptB.id}/members`).set(hAdminA())).status)).toBe(true));
  it("adminA cannot read org B dept members even with ?orgId spoof", async () => expect(blocked((await api().get(`/api/departments/${fx.deptB.id}/members?orgId=${fx.orgB.id}`).set(hAdminA())).status)).toBe(true));
  it("adminA cannot enumerate org B user's departments (blocked or empty — no org-B data)", async () => {
    const r = await api().get(`/api/departments/user/${fx.adminB.id}`).set(hAdminA());
    if (r.status === 200) expect(JSON.stringify(r.body)).not.toContain("Dept B"); // org-filtered → empty, no leak
    else expect(blocked(r.status)).toBe(true);
  });
  it("ACCOUNT: adminA cannot add a member to org B dept, and none is added", async () => {
    const r = await api().post(`/api/departments/${fx.deptB.id}/members`).set(hAdminA()).send({ userId: fx.viewerA.id });
    expect(blocked(r.status)).toBe(true);
    const rows = await db().select().from(userDepartmentsTable).where(eq(userDepartmentsTable.departmentId, fx.deptB.id));
    expect(rows.map(r => r.userId)).not.toContain(fx.viewerA.id);
  });
  it("DELETE rejected leaves org B dept intact: adminA PUT org B dept", async () => {
    const r = await api().put(`/api/departments/${fx.deptB.id}`).set(hAdminA()).send({ name: "HIJACKED" });
    expect(blocked(r.status)).toBe(true);
    const [row] = await db().select().from(departmentsTable).where(eq(departmentsTable.id, fx.deptB.id));
    expect(row.name).toBe("Dept B");
  });
  it("adminA CAN read own org dept members", async () => expect((await api().get(`/api/departments/${fx.deptA.id}/members`).set(hAdminA())).status).toBe(200));
});

describe("DEBT-009 extended — meetings / general correspondence", () => {
  it("adminA cannot read org B meeting", async () => expect(blocked((await api().get(`/api/meetings/${fx.meetingB.id}`).set(hAdminA())).status)).toBe(true));
  it("adminA cannot read org B general correspondence", async () => expect(blocked((await api().get(`/api/general/correspondence/${fx.corrB.id}`).set(hAdminA())).status)).toBe(true));
  it("adminA cannot reply into org B general correspondence", async () => expect(blocked((await api().post(`/api/general/correspondence/${fx.corrB.id}/reply`).set(hAdminA()).send({ subject: "r", body: "x" })).status)).toBe(true));
  it("adminA cannot read org B correspondence share-status", async () => expect(blocked((await api().get(`/api/general/correspondence/${fx.corrB.id}/share`).set(hAdminA())).status)).toBe(true));
});

describe("DEBT-009 extended — project-scoped routers (adminA has no access to project B)", () => {
  it("project departments", async () => expect(blocked((await api().get(`/api/projects/${fx.projectB.id}/departments`).set(hAdminA())).status)).toBe(true));
  it("project governance stats", async () => expect(blocked((await api().get(`/api/projects/${fx.projectB.id}/governance/stats`).set(hAdminA())).status)).toBe(true));
  it("project role-overrides", async () => expect(blocked((await api().get(`/api/projects/${fx.projectB.id}/role-overrides`).set(hAdminA())).status)).toBe(true));
});

describe("DEBT-009 extended — document/transmittal id NOT bound to foreign resource", () => {
  it("IDOR: adminA uses OWN project A but org B's document id → 404", async () => {
    const r = await api().get(`/api/projects/${fx.projectA.id}/documents/${fx.docB.id}/activity`).set(hAdminA());
    expect(r.status).toBe(404);
  });
  it("IDOR: adminA own project A + org B document reviews → 404", async () => {
    const r = await api().get(`/api/projects/${fx.projectA.id}/documents/${fx.docB.id}/reviews`).set(hAdminA());
    expect(r.status).toBe(404);
  });
  it("IDOR: adminA own project A + org B transmittal history → 404", async () => {
    const r = await api().get(`/api/projects/${fx.projectA.id}/transmittals/${fx.transmittalB.id}/history`).set(hAdminA());
    expect(blocked(r.status)).toBe(true); // foreign transmittal not bound to own project → 404 (or 403)

  });
  it("global-documents revisions of org B doc → blocked", async () => {
    const r = await api().get(`/api/documents/${fx.docB.id}/revisions`).set(hAdminA());
    expect(blocked(r.status)).toBe(true);
  });
});

describe("DEBT-009 extended — re-sweep catches (users list by projectId, chain create)", () => {
  it("GET /users?projectId=<org B project> as adminA (non-member) → 403 (no member PII leak)", async () => {
    const r = await api().get(`/api/users?projectId=${fx.projectB.id}`).set(hAdminA());
    expect(r.status).toBe(403);
  });
  it("GET /users?projectId=<own project A> as adminA (member) → 200", async () => {
    const r = await api().get(`/api/users?projectId=${fx.projectA.id}`).set(hAdminA());
    expect(r.status).toBe(200);
  });
  it("GET /users?projectId=<org B project> as system_owner → 200 (global)", async () => {
    const r = await api().get(`/api/users?projectId=${fx.projectB.id}`).set(hOwner());
    expect(r.status).toBe(200);
  });
  it("POST submission-chain on org B's project as adminA → blocked (no cross-tenant write)", async () => {
    const r = await api().post(`/api/projects/${fx.projectB.id}/submission-chains`).set(hAdminA())
      .send({ title: "hijack chain", type: "submittal" });
    expect(blocked(r.status)).toBe(true);
  });
});

describe("DEBT-009 extended — system_owner keeps global scope", () => {
  it("system_owner reads org B entity → 200", async () => expect((await api().get(`/api/entities/${fx.entityB.id}?orgId=${fx.orgB.id}`).set(hOwner())).status).toBe(200));
  it("system_owner reads org B meeting → 200", async () => expect((await api().get(`/api/meetings/${fx.meetingB.id}`).set(hOwner())).status).toBe(200));
});

describe("DEBT-009 extended — lower role (viewer) no escalation", () => {
  it("viewerA cannot read org B entity", async () => expect(blocked((await api().get(`/api/entities/${fx.entityB.id}`).set(hViewerA())).status)).toBe(true));
  it("viewerA cannot read org B meeting", async () => expect(blocked((await api().get(`/api/meetings/${fx.meetingB.id}`).set(hViewerA())).status)).toBe(true));
});
