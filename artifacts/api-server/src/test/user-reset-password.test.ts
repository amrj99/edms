/**
 * user-reset-password.test.ts
 *
 * Regression tests for B1: admin reset-password must clear mustChangePassword.
 *
 * QA Plan reference: TC 3.2.1 — admin resets password → user can login directly
 *                    TC 3.2.2 — short password rejected
 *                    TC 3.2.3 — cross-org reset denied
 *
 * Before this fix, POST /api/users/:id/reset-password set the new passwordHash
 * but did NOT clear mustChangePassword. The user could not log in because the
 * login response contained mustChangePassword: true, and the frontend redirected
 * to /set-password which requires an invitation token.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./helpers/index.js";
import {
  createOrg,
  createUser,
  resetFactoryCounters,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { makeToken } from "./helpers/auth.js";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── DB isolation ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateAllTables();
  resetFactoryCounters();
});

afterEach(async () => {
  await truncateAllTables();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setMustChangePassword(userId: number, value: boolean) {
  const db = getTestDb();
  await db
    .update(usersTable)
    .set({ mustChangePassword: value })
    .where(eq(usersTable.id, userId));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/users/:id/reset-password", () => {
  describe("B1 — mustChangePassword is cleared after admin reset", () => {
    it("admin resets password → user logs in successfully with mustChangePassword: false", async () => {
      const org = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });
      const target = await createUser({
        organizationId: org.id,
        role: "document_controller",
        password: "OldPass123!",
      });

      // Simulate admin-created user state: mustChangePassword = true
      await setMustChangePassword(target.id, true);

      const adminToken = makeToken({
        id: admin.id,
        email: admin.email,
        role: "admin",
        organizationId: org.id,
      });

      const newPassword = "NewSecurePass99!";

      // Step 1: Admin resets password
      const resetRes = await api()
        .post(`/api/users/${target.id}/reset-password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ newPassword });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.message).toBe("Password reset successfully");

      // Step 2: Verify mustChangePassword is false in DB
      const [updated] = await getTestDb()
        .select({ mustChangePassword: usersTable.mustChangePassword })
        .from(usersTable)
        .where(eq(usersTable.id, target.id))
        .limit(1);

      expect(updated?.mustChangePassword).toBe(false);

      // Step 3: User logs in with new password → mustChangePassword: false in response
      const loginRes = await api()
        .post("/api/auth/login")
        .send({ email: target.email, password: newPassword });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
      expect(loginRes.body.user.mustChangePassword).toBe(false);
    });

    it("before fix: mustChangePassword stays true if not cleared (regression guard)", async () => {
      const org = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });
      const target = await createUser({
        organizationId: org.id,
        role: "document_controller",
      });

      await setMustChangePassword(target.id, true);

      const adminToken = makeToken({
        id: admin.id,
        email: admin.email,
        role: "admin",
        organizationId: org.id,
      });

      await api()
        .post(`/api/users/${target.id}/reset-password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ newPassword: "AnotherPass456!" });

      // After the fix this MUST be false — if this test fails, the fix regressed
      const [updated] = await getTestDb()
        .select({ mustChangePassword: usersTable.mustChangePassword })
        .from(usersTable)
        .where(eq(usersTable.id, target.id))
        .limit(1);

      expect(updated?.mustChangePassword).toBe(false);
    });
  });

  describe("TC 3.2.2 — password validation", () => {
    it("rejects password shorter than 8 characters", async () => {
      const org = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });
      const target = await createUser({ organizationId: org.id, role: "viewer" });

      const adminToken = makeToken({
        id: admin.id,
        email: admin.email,
        role: "admin",
        organizationId: org.id,
      });

      const res = await api()
        .post(`/api/users/${target.id}/reset-password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ newPassword: "short" });

      expect(res.status).toBe(400);
    });

    it("rejects missing newPassword", async () => {
      const org = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });
      const target = await createUser({ organizationId: org.id, role: "viewer" });

      const adminToken = makeToken({
        id: admin.id,
        email: admin.email,
        role: "admin",
        organizationId: org.id,
      });

      const res = await api()
        .post(`/api/users/${target.id}/reset-password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("TC 3.2.3 — cross-org reset denied", () => {
    it("admin cannot reset password for user in a different org", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const adminA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB = await createUser({ organizationId: orgB.id, role: "viewer" });

      const adminAToken = makeToken({
        id: adminA.id,
        email: adminA.email,
        role: "admin",
        organizationId: orgA.id,
      });

      const res = await api()
        .post(`/api/users/${userB.id}/reset-password`)
        .set({ Authorization: `Bearer ${adminAToken}` })
        .send({ newPassword: "ValidPass123!" });

      expect(res.status).toBe(403);
    });
  });

  describe("Access control", () => {
    it("unauthenticated request returns 401", async () => {
      const res = await api()
        .post("/api/users/999/reset-password")
        .send({ newPassword: "ValidPass123!" });

      expect(res.status).toBe(401);
    });

    it("reviewer cannot reset another user's password", async () => {
      const org = await createOrg();
      const reviewer = await createUser({ organizationId: org.id, role: "reviewer" });
      const target = await createUser({ organizationId: org.id, role: "viewer" });

      const reviewerToken = makeToken({
        id: reviewer.id,
        email: reviewer.email,
        role: "reviewer",
        organizationId: org.id,
      });

      const res = await api()
        .post(`/api/users/${target.id}/reset-password`)
        .set({ Authorization: `Bearer ${reviewerToken}` })
        .send({ newPassword: "ValidPass123!" });

      expect(res.status).toBe(403);
    });

    it("user can reset their own password", async () => {
      const org = await createOrg();
      const user = await createUser({
        organizationId: org.id,
        role: "viewer",
        password: "OldPass123!",
      });

      const userToken = makeToken({
        id: user.id,
        email: user.email,
        role: "viewer",
        organizationId: org.id,
      });

      const res = await api()
        .post(`/api/users/${user.id}/reset-password`)
        .set({ Authorization: `Bearer ${userToken}` })
        .send({ newPassword: "NewSelfPass123!" });

      expect(res.status).toBe(200);
    });
  });
});
