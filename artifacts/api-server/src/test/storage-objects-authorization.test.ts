/**
 * storage-objects-authorization.test.ts
 *
 * Security Regression Suite — GET /api/storage/objects/*path Authorization (H2)
 *
 * Previously, GET /api/storage/objects/*path only required a valid Bearer
 * token (or view token) — ANY authenticated user, regardless of organization,
 * could fetch ANY object whose key they knew/guessed, because no
 * ownership/Organization check was performed before serving the file.
 *
 * This suite verifies:
 *   1. A user from the SAME organization as the document referencing the
 *      object is NOT blocked by the org-ownership check (any failure past
 *      that point is due to the test environment lacking real cloud storage,
 *      i.e. PRIVATE_OBJECT_DIR — not an authorization failure).
 *   2. A user from a DIFFERENT organization is denied (403) before the file
 *      is ever looked up in storage.
 *   3. An unauthenticated request is denied (401).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { documentsTable } from "@workspace/db";

let orgA: { id: number };
let orgB: { id: number };
let projectA: { id: number };
let userA: { id: number; organizationId: number };   // member of orgA — owns the document
let userB: { id: number; organizationId: number };   // member of orgB — different org

const OBJECT_KEY = "uploads/h2-test-object-key";
const SERVE_URL = `/api/storage/objects/${OBJECT_KEY}`;

const db = getTestDb();

beforeAll(async () => {
  await truncateAllTables();

  orgA = await createOrg({ name: "Storage Org A", code: "STGORGA" });
  orgB = await createOrg({ name: "Storage Org B", code: "STGORGB" });
  projectA = await createProject({ organizationId: orgA.id, name: "Storage Project A", code: "STGP001" });

  userA = await createUser({ organizationId: orgA.id, role: "member", email: "usera@stg.test" });
  userB = await createUser({ organizationId: orgB.id, role: "member", email: "userb@stg.test" });

  // A document in org A referencing the cloud object via fileUrl.
  await db.insert(documentsTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    createdById: userA.id,
    documentNumber: "DOC-H2-001",
    title: "H2 Object Ownership Doc",
    revision: "A",
    status: "draft",
    fileUrl: SERVE_URL,
  });
});

afterAll(async () => {
  await truncateAllTables();
});

describe("GET /api/storage/objects/*path — ownership/org access check (H2)", () => {
  it("a same-organization user is not blocked by the org-ownership check", async () => {
    const res = await api()
      .get(`/api/storage/objects/${OBJECT_KEY}`)
      .set(authHeader("member", userA.id, orgA.id));

    // The org-ownership check must pass for a same-org user. Any remaining
    // failure (e.g. 500 because PRIVATE_OBJECT_DIR isn't configured in this
    // test environment) is unrelated to authorization.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("a different-organization user is denied with 403 before the object is fetched", async () => {
    const res = await api()
      .get(`/api/storage/objects/${OBJECT_KEY}`)
      .set(authHeader("member", userB.id, orgB.id));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/different organization/i);
  });

  it("an unauthenticated request is denied with 401", async () => {
    const res = await api().get(`/api/storage/objects/${OBJECT_KEY}`);

    expect(res.status).toBe(401);
  });
});
