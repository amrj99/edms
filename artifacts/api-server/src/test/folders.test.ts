/**
 * folders.test.ts
 *
 * Integration tests for folder CRUD endpoints under
 * GET|POST|PUT|DELETE /api/projects/:projectId/folders
 *
 * ── What we test ──────────────────────────────────────────────────────────────
 *
 *   [B-2-C] Security: Org B user cannot create / rename / delete folders in
 *           Org A's project (missing canAccessProject — fixed in B-2).
 *
 *   [B-2]   ORDER BY: GET /folders returns roots before children, both groups
 *           sorted alphabetically by name (parentId NULLS FIRST, name ASC).
 *
 *   [B-2]   Happy path: authorized user can CREATE → RENAME → DELETE a folder.
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
import { foldersTable, orgConfigTable, projectMembersTable } from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixtures {
  orgAId:     number;
  orgBId:     number;
  userAId:    number;
  userBId:    number;
  userAOrgId: number;
  userBOrgId: number;
  projectAId: number;
  seedFolderId: number; // pre-existing folder in Org A's project
}

let fx: Fixtures;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();

  const orgA = await createOrg({ name: "FolderOrgA", code: "FLDA" });
  const orgB = await createOrg({ name: "FolderOrgB", code: "FLDB" });

  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "folder-a@test.edms" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "folder-b@test.edms" });

  const projectA = await createProject({ organizationId: orgA.id, name: "Folder Project A", code: "FPA-001" });

  // Enable modules so the module gate doesn't shadow the access check
  await db.insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { dashboard: true, deliverables: true, registers: true, notifications: true } },
    { organizationId: orgB.id, modules: { dashboard: true, deliverables: true, registers: true, notifications: true } },
  ]);

  // userA is a member of projectA; userB is NOT
  await db.insert(projectMembersTable).values({
    projectId: projectA.id,
    userId: userA.id,
    role: "admin",
  });

  // Pre-existing folder for PUT / DELETE isolation tests
  const [seedFolder] = await db.insert(foldersTable).values({
    name: "Seed Folder",
    projectId: projectA.id,
    organizationId: orgA.id,
  }).returning();

  fx = {
    orgAId:       orgA.id,
    orgBId:       orgB.id,
    userAId:      userA.id,
    userBId:      userB.id,
    userAOrgId:   orgA.id,
    userBOrgId:   orgB.id,
    projectAId:   projectA.id,
    seedFolderId: seedFolder.id,
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── [B-2-C] Tenant Isolation — folder mutations ──────────────────────────────

describe("[B-2-C] Folder mutation tenant isolation", () => {

  it("POST /folders — Org B user cannot create a folder in Org A project", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userBId, fx.userBOrgId, "folder-b@test.edms"))
      .send({ name: "Attack Folder" });

    expect(
      [403, 404],
      `Expected 403/404, got ${res.status} — POST /folders cross-org TENANT ISOLATION FAILURE`,
    ).toContain(res.status);
  });

  it("PUT /folders/:id — Org B user cannot rename a folder in Org A project", async () => {
    const res = await api()
      .put(`/api/projects/${fx.projectAId}/documents/folders/${fx.seedFolderId}`)
      .set(authHeader("admin", fx.userBId, fx.userBOrgId, "folder-b@test.edms"))
      .send({ name: "Renamed by Attacker" });

    expect(
      [403, 404],
      `Expected 403/404, got ${res.status} — PUT /folders/:id cross-org TENANT ISOLATION FAILURE`,
    ).toContain(res.status);
  });

  it("DELETE /folders/:id — Org B user cannot delete a folder in Org A project", async () => {
    const res = await api()
      .delete(`/api/projects/${fx.projectAId}/documents/folders/${fx.seedFolderId}`)
      .set(authHeader("admin", fx.userBId, fx.userBOrgId, "folder-b@test.edms"));

    expect(
      [403, 404],
      `Expected 403/404, got ${res.status} — DELETE /folders/:id cross-org TENANT ISOLATION FAILURE`,
    ).toContain(res.status);
  });

  it("Seed folder still exists after failed cross-org mutations", async () => {
    // Verify Org B attacks did not modify the folder
    const res = await api()
      .get(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"));

    expect(res.status).toBe(200);
    const seedFolder = res.body.folders.find((f: { id: number }) => f.id === fx.seedFolderId);
    expect(seedFolder).toBeDefined();
    expect(seedFolder.name).toBe("Seed Folder");
  });
});

// ─── [B-2] GET /folders ORDER BY ─────────────────────────────────────────────

describe("[B-2] GET /folders — ORDER BY parentId NULLS FIRST, name ASC", () => {

  it("returns root folders before child folders, both groups alphabetically sorted", async () => {
    const db = getTestDb();

    // Seed 2 roots (inserted in reverse alpha order so DB insert order ≠ expected order)
    const [rootZ] = await db.insert(foldersTable).values({
      name: "Zebra Root",
      projectId: fx.projectAId,
      organizationId: fx.orgAId,
    }).returning();
    const [rootA] = await db.insert(foldersTable).values({
      name: "Apple Root",
      projectId: fx.projectAId,
      organizationId: fx.orgAId,
    }).returning();

    // 2 children of rootA (also in reverse alpha to test child sorting)
    await db.insert(foldersTable).values([
      { name: "Z Child", projectId: fx.projectAId, organizationId: fx.orgAId, parentId: rootA.id },
      { name: "A Child", projectId: fx.projectAId, organizationId: fx.orgAId, parentId: rootA.id },
    ]);

    const res = await api()
      .get(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"));

    expect(res.status).toBe(200);
    const { folders } = res.body;
    expect(Array.isArray(folders)).toBe(true);

    // Split into roots and non-roots
    const roots    = folders.filter((f: { parentId: number | null }) => f.parentId === null);
    const children = folders.filter((f: { parentId: number | null }) => f.parentId !== null);

    // All roots must appear before all children in the response array
    const lastRootIdx    = Math.max(...roots.map((_: unknown, i: number) => folders.indexOf(roots[i])));
    const firstChildIdx  = Math.min(...children.map((_: unknown, i: number) => folders.indexOf(children[i])));
    if (children.length > 0) {
      expect(lastRootIdx).toBeLessThan(firstChildIdx);
    }

    // Roots are sorted A→Z
    const rootNames = roots.map((f: { name: string }) => f.name);
    expect(rootNames).toEqual([...rootNames].sort());

    // Children are sorted A→Z among themselves
    const childNames = children.map((f: { name: string }) => f.name);
    expect(childNames).toEqual([...childNames].sort());

    // Our newly-inserted roots are present and in the right relative order
    const newRootNames = rootNames.filter((n: string) => n === "Apple Root" || n === "Zebra Root");
    const appleIdx = newRootNames.indexOf("Apple Root");
    const zebraIdx = newRootNames.indexOf("Zebra Root");
    expect(appleIdx).toBeLessThan(zebraIdx);
  });

  it("GET /folders response includes all expected fields", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"));

    expect(res.status).toBe(200);
    const { folders } = res.body;
    expect(folders.length).toBeGreaterThan(0);

    const f = folders[0];
    expect(f).toHaveProperty("id");
    expect(f).toHaveProperty("name");
    expect(f).toHaveProperty("projectId");
    expect(f).toHaveProperty("parentId");
    expect(f).toHaveProperty("createdAt");
    expect(f).toHaveProperty("documentCount");
  });
});

// ─── [B-2] Happy path — authorized user CRUD ──────────────────────────────────

describe("[B-2] Folder CRUD — authorized user", () => {
  let createdFolderId: number;

  it("POST /folders — creates folder for project member (201)", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"))
      .send({ name: "My New Folder" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "My New Folder",
      projectId: fx.projectAId,
      documentCount: 0,
    });
    createdFolderId = res.body.id;
  });

  it("POST /folders — rejects empty name (400)", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"))
      .send({ name: "  " });

    expect(res.status).toBe(400);
  });

  it("PUT /folders/:id — renames folder for project member (200)", async () => {
    const res = await api()
      .put(`/api/projects/${fx.projectAId}/documents/folders/${createdFolderId}`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"))
      .send({ name: "Renamed Folder" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Folder");
  });

  it("PUT /folders/:id — returns 404 for non-existent folder", async () => {
    const res = await api()
      .put(`/api/projects/${fx.projectAId}/documents/folders/999999`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"))
      .send({ name: "Ghost Folder" });

    expect(res.status).toBe(404);
  });

  it("DELETE /folders/:id — deletes folder for project member (204)", async () => {
    const res = await api()
      .delete(`/api/projects/${fx.projectAId}/documents/folders/${createdFolderId}`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"));

    expect(res.status).toBe(204);
  });

  it("Deleted folder no longer appears in GET /folders", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectAId}/documents/folders`)
      .set(authHeader("admin", fx.userAId, fx.userAOrgId, "folder-a@test.edms"));

    expect(res.status).toBe(200);
    const ids = res.body.folders.map((f: { id: number }) => f.id);
    expect(ids).not.toContain(createdFolderId);
  });
});
