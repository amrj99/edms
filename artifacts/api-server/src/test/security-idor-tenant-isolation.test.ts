/**
 * security-idor-tenant-isolation.test.ts  (DEBT-009)
 *
 * Cross-tenant IDOR closure regression. A tenant ADMIN of org A must NOT be able
 * to read or mutate org B's resources by enumerating IDs. Only `system_owner`
 * spans tenants. Root cause found in the Final Security Review: several handlers
 * used `isSysAdmin` (= admin || system_owner) as the cross-org bypass, so tenant
 * admins escaped isolation.
 *
 * This suite is written to the DESIRED end-state, so before the fix the currently
 * VULNERABLE routes FAIL (proving the reproducer) and after the fix they pass —
 * while own-tenant behaviour and system_owner global scope stay intact.
 *
 * NOTE: reset-password is state-changing — tested here ONLY against the disposable
 * test DB (never Production), proving org A cannot reset an org B user's password.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { tasksTable, projectMembersTable } from "@workspace/db";

interface Fx {
  orgA: { id: number }; orgB: { id: number };
  adminA: { id: number }; viewerA: { id: number };
  adminB: { id: number }; memberB: { id: number };
  sysOwner: { id: number };
  projectB: { id: number }; taskB: { id: number };
}
let fx: Fx;

const hAdminA  = () => authHeader("admin",        fx.adminA.id,  fx.orgA.id, "admin@a.test");
const hViewerA = () => authHeader("viewer",       fx.viewerA.id, fx.orgA.id, "viewer@a.test");
const hOwner   = () => authHeader("system_owner", fx.sysOwner.id, fx.orgA.id, "owner@platform.test");

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const orgA = await createOrg({ name: "Tenant A", code: "IDORA" });
  const orgB = await createOrg({ name: "Tenant B", code: "IDORB" });
  const adminA  = await createUser({ organizationId: orgA.id, role: "admin",        email: "admin@a.test" });
  const viewerA = await createUser({ organizationId: orgA.id, role: "viewer",       email: "viewer@a.test" });
  const adminB  = await createUser({ organizationId: orgB.id, role: "admin",        email: "admin@b.test" });
  const memberB = await createUser({ organizationId: orgB.id, role: "member",       email: "member@b.test" });
  const sysOwner = await createUser({ organizationId: orgA.id, role: "system_owner", email: "owner@platform.test" });
  const projectB = await createProject({ organizationId: orgB.id, createdById: adminB.id, name: "B Project", code: "IDORB-001" });
  await db.insert(projectMembersTable).values({ projectId: projectB.id, userId: adminB.id, role: "admin" });
  const [taskB] = await db.insert(tasksTable).values({
    title: "Org B secret task", createdById: adminB.id, organizationId: orgB.id, projectId: projectB.id, status: "pending", priority: "medium",
  }).returning();
  fx = { orgA, orgB, adminA, viewerA, adminB, memberB, sysOwner, projectB, taskB };
});
afterAll(async () => { await truncateAllTables(); });

const blocked = (s: number) => [403, 404].includes(s);

describe("DEBT-009 — tenant admin of A CANNOT reach org B by id (READ)", () => {
  it("GET /api/users/:id — adminA reading an org B user → blocked", async () => {
    const r = await api().get(`/api/users/${fx.adminB.id}`).set(hAdminA());
    expect(blocked(r.status), `got ${r.status}: ${JSON.stringify(r.body).slice(0,120)}`).toBe(true);
  });
  it("GET /api/tasks/:id — adminA reading org B's task → blocked", async () => {
    const r = await api().get(`/api/tasks/${fx.taskB.id}`).set(hAdminA());
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
  it("GET /api/projects/:id/members — adminA reading org B's project members → blocked", async () => {
    const r = await api().get(`/api/projects/${fx.projectB.id}/members`).set(hAdminA());
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
  it("client-supplied orgId cannot re-scope: adminA + org B task id + ?orgId=A → still blocked", async () => {
    const r = await api().get(`/api/tasks/${fx.taskB.id}?orgId=${fx.orgA.id}`).set(hAdminA());
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
});

describe("DEBT-009 — lower roles get no escalation across tenants", () => {
  it("viewerA reading org B user → blocked", async () => {
    const r = await api().get(`/api/users/${fx.adminB.id}`).set(hViewerA());
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
  it("viewerA reading org B task → blocked", async () => {
    const r = await api().get(`/api/tasks/${fx.taskB.id}`).set(hViewerA());
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
});

describe("DEBT-009 — state-changing cross-tenant is blocked (test DB only)", () => {
  it("POST /api/users/:id/reset-password — adminA resetting org B user → 403 (no cross-tenant takeover)", async () => {
    const r = await api().post(`/api/users/${fx.adminB.id}/reset-password`).set(hAdminA()).send({ newPassword: "N3wPassw0rd!" });
    expect(r.status).toBe(403);
  });
  it("PUT /api/tasks/:id — adminA editing org B's task → blocked", async () => {
    const r = await api().put(`/api/tasks/${fx.taskB.id}`).set(hAdminA()).send({ title: "hijacked" });
    expect(blocked(r.status), `got ${r.status}`).toBe(true);
  });
});

describe("DEBT-009 — own-tenant behaviour still works", () => {
  it("adminA reads a user in its own org → 200", async () => {
    const r = await api().get(`/api/users/${fx.viewerA.id}`).set(hAdminA());
    expect(r.status).toBe(200);
  });
});

describe("DEBT-009 — system_owner keeps intended global scope", () => {
  it("system_owner reads an org B user → 200", async () => {
    const r = await api().get(`/api/users/${fx.adminB.id}`).set(hOwner());
    expect(r.status).toBe(200);
  });
  it("system_owner reads org B's task → 200", async () => {
    const r = await api().get(`/api/tasks/${fx.taskB.id}`).set(hOwner());
    expect(r.status).toBe(200);
  });
});
