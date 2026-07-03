/**
 * input-validation.test.ts — Sprint C-5: Input Validation Critical Routes
 *
 * Verifies that the parseBody() middleware correctly rejects malformed input
 * on the 4 highest-risk write endpoints and returns a consistent error shape:
 *   { error: "VALIDATION_ERROR", message: "Validation failed", fields: {...} }
 *
 * Design notes:
 *   - Validation runs BEFORE business logic (project lookup, org checks, etc.)
 *     so these tests do not require fully-provisioned projects or documents.
 *   - Correspondence uses /api/correspondence (global route) with org_config
 *     set up to satisfy requireModule("correspondence").
 *   - All 8 scenarios target a different field/route combination.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  makeToken,
  getTestDb,
  truncateAllTables,
  createOrg,
  createUser,
  createProject,
} from "./helpers/index.js";
import { orgConfigTable } from "@workspace/db";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

let orgId: number;
let userId: number;
let projectId: number;
let adminToken: string;

beforeAll(async () => {
  await truncateAllTables();

  const org  = await createOrg({ name: "Validation Test Org", code: "VAL01" });
  orgId = org.id;

  const user = await createUser({ organizationId: orgId, role: "admin", email: "val-admin@test.edms" });
  userId = user.id;

  adminToken = makeToken({ id: userId, email: user.email, role: "admin", organizationId: orgId });

  const project = await createProject({ organizationId: orgId });
  projectId = project.id;

  // Enable correspondence module — requireModule("correspondence") is fail-closed
  // and needs an org_config row. The key absence → enabled, but the row must exist.
  const db = getTestDb();
  await db.insert(orgConfigTable).values({
    organizationId: orgId,
    modules: { correspondence: true, dashboard: true, deliverables: true, registers: true, notifications: true },
  });
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── Shared assertion ─────────────────────────────────────────────────────────

function expectValidationError(res: { status: number; body: Record<string, unknown> }) {
  expect(res.status).toBe(400);
  expect(res.body.error).toBe("VALIDATION_ERROR");
  expect(res.body.message).toBe("Validation failed");
  expect(res.body.fields).toBeDefined();
}

// ─── users POST / ─────────────────────────────────────────────────────────────

describe("POST /api/users — createUserSchema", () => {
  it("rejects missing email with VALIDATION_ERROR and fields.email", async () => {
    const res = await api()
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Test", lastName: "User", role: "member" });

    expectValidationError(res);
    expect(res.body.fields.email).toBeDefined();
  });

  it("rejects malformed email with VALIDATION_ERROR and fields.email", async () => {
    const res = await api()
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "not-an-email", firstName: "Test", lastName: "User", role: "member" });

    expectValidationError(res);
    expect(res.body.fields.email).toBeDefined();
  });

  it("rejects disallowed role with VALIDATION_ERROR and fields.role", async () => {
    const res = await api()
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "new@test.edms", firstName: "Test", lastName: "User", role: "super_god" });

    expectValidationError(res);
    expect(res.body.fields.role).toBeDefined();
  });
});

// ─── users PUT /:id ───────────────────────────────────────────────────────────

describe("PUT /api/users/:id — updateUserSchema", () => {
  it("rejects role=system_owner with VALIDATION_ERROR and fields.role", async () => {
    // system_owner is not an assignable org role — blocked by the enum schema.
    // Validation fires before the DB org-boundary check.
    const res = await api()
      .put(`/api/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "system_owner" });

    expectValidationError(res);
    expect(res.body.fields.role).toBeDefined();
  });

  it("rejects invalid role string with VALIDATION_ERROR and fields.role", async () => {
    const res = await api()
      .put(`/api/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "superuser" });

    expectValidationError(res);
    expect(res.body.fields.role).toBeDefined();
  });
});

// ─── correspondence POST / ────────────────────────────────────────────────────

describe("POST /api/correspondence — createCorrespondenceSchema", () => {
  it("rejects missing subject with VALIDATION_ERROR and fields.subject", async () => {
    const res = await api()
      .post("/api/correspondence")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "letter", toUserIds: [] });

    expectValidationError(res);
    expect(res.body.fields.subject).toBeDefined();
  });

  it("rejects toUserIds with non-integer elements with VALIDATION_ERROR", async () => {
    const res = await api()
      .post("/api/correspondence")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ subject: "Test", type: "letter", toUserIds: ["not-a-number"] });

    expectValidationError(res);
    // The path is "toUserIds.0" (first element failed)
    expect(Object.keys(res.body.fields).some(k => k.startsWith("toUserIds"))).toBe(true);
  });
});

// ─── documents POST / ─────────────────────────────────────────────────────────

describe("POST /api/projects/:projectId/documents — createDocumentSchema", () => {
  it("rejects missing title with VALIDATION_ERROR and fields.title", async () => {
    // Validation fires before the project/tenant check — no need for a real project.
    const res = await api()
      .post(`/api/projects/${projectId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ description: "some description" });

    expectValidationError(res);
    expect(res.body.fields.title).toBeDefined();
  });

  it("rejects invalid direction enum with VALIDATION_ERROR and fields.direction", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Test Document", direction: "sideways" });

    expectValidationError(res);
    expect(res.body.fields.direction).toBeDefined();
  });
});
