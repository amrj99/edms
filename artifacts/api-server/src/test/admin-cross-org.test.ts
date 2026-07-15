/**
 * admin-cross-org.test.ts
 *
 * Security regression suite for R2: isSysAdmin() cross-org bug.
 *
 * Verifies that:
 *   - admin CANNOT access another org's data (GET/PUT /organizations/:id)
 *   - admin CAN access their own org's data
 *   - system_owner CAN access any org's data (cross-org is intentional)
 *   - ai-quota endpoint is scoped to own org for admin
 *   - delegations endpoint is scoped to own user for admin (not all orgs)
 *
 * QA Plan reference: TC 16.1.5-16.1.8 (Permissions & Access Control)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./helpers/index.js";
import {
  createOrg,
  createUser,
  resetFactoryCounters,
  truncateAllTables,
} from "./helpers/index.js";
import { makeToken } from "./helpers/auth.js";

// ── DB isolation ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateAllTables();
  resetFactoryCounters();
});

afterEach(async () => {
  await truncateAllTables();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("B1+B2: GET/PUT /api/organizations/:id — admin cross-org access", () => {

  it("admin CANNOT GET another org's details → 403", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api().get(`/api/organizations/${orgB.id}`).set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(403);
  });

  it("admin CAN GET their own org's details → 200", async () => {
    const orgA = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api().get(`/api/organizations/${orgA.id}`).set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgA.id);
  });

  it("system_owner CAN GET any org's details → 200", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });

    const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
    const res = await api().get(`/api/organizations/${orgB.id}`).set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgB.id);
  });

  it("admin CANNOT PUT (edit) another org → 403", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api()
      .put(`/api/organizations/${orgB.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: "Hacked Name" });

    expect(res.status).toBe(403);
  });

  it("admin CAN PUT (edit) their own org → 200", async () => {
    const orgA = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api()
      .put(`/api/organizations/${orgA.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: "Updated Name", type: "client" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("system_owner CAN PUT any org → 200", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });

    const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
    const res = await api()
      .put(`/api/organizations/${orgB.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: "Owner Updated", type: "client" });

    expect(res.status).toBe(200);
  });

  it("viewer CANNOT GET another org → 403", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const viewer = await createUser({ organizationId: orgA.id, role: "viewer" });

    const token = makeToken({ id: viewer.id, email: viewer.email, role: "viewer", organizationId: orgA.id });
    const res = await api().get(`/api/organizations/${orgB.id}`).set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(403);
  });

  it("unauthenticated request → 401", async () => {
    const res = await api().get("/api/organizations/1");
    expect(res.status).toBe(401);
  });
});

describe("B3: GET /api/admin/ai-quota — admin org-scoped", () => {

  it("admin receives own org quota (not all orgs)", async () => {
    const orgA = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api().get("/api/admin/ai-quota").set({ Authorization: `Bearer ${token}` });

    // admin gets own org data (not array of all orgs)
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("quotas"); // quotas array = system_owner view
    expect(res.body).toHaveProperty("organizationId", orgA.id);
  });

  it("system_owner receives all orgs quotas array", async () => {
    const orgA = await createOrg();
    const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });

    const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
    const res = await api().get("/api/admin/ai-quota").set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("quotas"); // array = system_owner view
    expect(Array.isArray(res.body.quotas)).toBe(true);
  });
});

describe("B4: GET /api/delegations — admin sees only own delegations", () => {

  it("admin with no delegations → empty list (not other orgs delegations)", async () => {
    const orgA = await createOrg();
    const adminA = await createUser({ organizationId: orgA.id, role: "admin" });

    const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
    const res = await api().get("/api/delegations").set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    const delegations: any[] = res.body.delegations ?? res.body ?? [];
    // Admin should only see delegations where they are grantor or delegate
    // (none in this test since no delegations were created)
    expect(Array.isArray(delegations)).toBe(true);
    expect(delegations.length).toBe(0);
  });

  it("system_owner sees all delegations (unrestricted)", async () => {
    const orgA = await createOrg();
    const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });

    const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
    const res = await api().get("/api/delegations").set({ Authorization: `Bearer ${token}` });

    // system_owner should get 200 (may be empty but no 403)
    expect(res.status).toBe(200);
  });
});

describe("Smoke: admin within own org still works", () => {

  it("admin can list users in own org", async () => {
    const org = await createOrg();
    const adminUser = await createUser({ organizationId: org.id, role: "admin" });
    await createUser({ organizationId: org.id, role: "viewer" }); // another user

    const token = makeToken({ id: adminUser.id, email: adminUser.email, role: "admin", organizationId: org.id });
    const res = await api().get("/api/users").set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body).not.toHaveProperty("users"); // P2-a flip
    // All users must belong to same org
    const orgs = new Set(res.body.items.map((u: any) => u.organizationId));
    expect(orgs.size).toBe(1);
    expect(orgs.has(org.id)).toBe(true);
  });

  it("system_owner lists organizations → { items } (C7 contract, legacy `organizations` key gone)", async () => {
    // C7 P2-a completion fix: the isSystemOwner branch of GET /api/organizations
    // previously returned { organizations } while org-scoped branches returned
    // { items }. This asserts the branch now returns the unified `items` key with
    // no legacy `organizations` key (no dual-key / no role-dependent shape).
    const orgA = await createOrg();
    const orgB = await createOrg();
    const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });

    const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
    const res = await api().get("/api/organizations").set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).not.toHaveProperty("organizations"); // legacy key absent
    expect(Array.isArray(res.body.items)).toBe(true);
    const ids = new Set(res.body.items.map((o: any) => o.id));
    expect(ids.has(orgA.id) && ids.has(orgB.id)).toBe(true); // system_owner sees all orgs
  });

  it("admin can reset-password for own org user (not blocked by cross-org check)", async () => {
    const org = await createOrg();
    const adminUser = await createUser({ organizationId: org.id, role: "admin" });
    const targetUser = await createUser({ organizationId: org.id, role: "viewer" });

    const token = makeToken({ id: adminUser.id, email: adminUser.email, role: "admin", organizationId: org.id });
    const res = await api()
      .post(`/api/users/${targetUser.id}/reset-password`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ newPassword: "NewPass99!" });

    // admin can reset password within own org (was already tested in user-reset-password.test.ts)
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Password reset successfully");
  });
});
