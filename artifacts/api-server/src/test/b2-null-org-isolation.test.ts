/**
 * b2-null-org-isolation.test.ts
 *
 * Proves — via the REAL access paths, not assumption — that a document whose
 * organization_id IS NULL (a "B2" legacy row, e.g. production documents 55/56/57)
 * is NOT exposed cross-organization:
 *   • project-scoped route (/api/projects/:id/documents) is gated by
 *     requireProjectAccess → an outside-org user gets 403;
 *   • the global register (/api/documents) is scoped to the caller's project
 *     memberships → the NULL-org doc never appears for an outside-org user;
 *   • control: a member of the owning project DOES see it.
 *
 * This is the automated authz test for the B2 classification. If it holds, B2 is
 * a Data-Integrity / defense-in-depth issue, not an active access vulnerability.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import {
  db, organizationsTable, usersTable, projectsTable, projectMembersTable, documentsTable,
} from "@workspace/db";
import { signToken } from "../lib/auth.js";
import { truncateAllTables } from "./helpers/index.js";
import app from "../app.js";

const FAKE_HASH = "$2b$12$testplaceholder00000000000000000000000000000000000000000";
const SECRET_TITLE = "ZZB2-NULLORG-SECRET-DOC";

interface Ctx { projectAId: number; nullDocId: number; ownerToken: string; outsiderToken: string; }

async function buildCtx(): Promise<Ctx> {
  // Org A owns project A; a document in it has organization_id = NULL (the B2 shape).
  const [orgA] = await db.insert(organizationsTable).values({ name: "B2 Owner Org", type: "consultant", subscriptionTier: "professional" }).returning();
  const [ownerAdmin] = await db.insert(usersTable).values({
    email: `b2-owner-${Date.now()}@test.local`, firstName: "Owner", lastName: "Admin",
    passwordHash: FAKE_HASH, role: "admin", organizationId: orgA.id, isActive: true, mustChangePassword: false,
  }).returning();
  const [projectA] = await db.insert(projectsTable).values({ name: "B2 Project A", code: `B2A-${Date.now()}`, organizationId: orgA.id, status: "active" }).returning();
  await db.insert(projectMembersTable).values({ projectId: projectA.id, userId: ownerAdmin.id, role: "admin" });
  const [nullDoc] = await db.insert(documentsTable).values({
    projectId: projectA.id, organizationId: null,        // ← the B2 condition
    documentNumber: `B2-DOC-${Date.now()}`, title: SECRET_TITLE, revision: "A", status: "draft", createdById: ownerAdmin.id,
  }).returning();

  // Org B: an unrelated user, NOT a member/party of project A.
  const [orgB] = await db.insert(organizationsTable).values({ name: "B2 Outsider Org", type: "consultant", subscriptionTier: "professional" }).returning();
  const [outsider] = await db.insert(usersTable).values({
    email: `b2-outsider-${Date.now()}@test.local`, firstName: "Out", lastName: "Sider",
    passwordHash: FAKE_HASH, role: "admin", organizationId: orgB.id, isActive: true, mustChangePassword: false,
  }).returning();

  return {
    projectAId: projectA.id, nullDocId: nullDoc.id,
    ownerToken: signToken({ id: ownerAdmin.id, email: ownerAdmin.email, role: "admin", organizationId: orgA.id }),
    outsiderToken: signToken({ id: outsider.id, email: outsider.email, role: "admin", organizationId: orgB.id }),
  };
}

let ctx: Ctx;
beforeEach(async () => { await truncateAllTables(); ctx = await buildCtx(); });
afterEach(async () => { await truncateAllTables(); });

describe("B2 (NULL-org document) — cross-org isolation", () => {
  it("outside-org user is DENIED the project-scoped documents route (requireProjectAccess → 403)", async () => {
    const res = await supertest(app).get(`/api/projects/${ctx.projectAId}/documents`).set("Authorization", `Bearer ${ctx.outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it("outside-org user does NOT see the NULL-org document in the global register", async () => {
    const res = await supertest(app).get("/api/documents").set("Authorization", `Bearer ${ctx.outsiderToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_TITLE);
    const items = (res.body.items ?? []) as any[];
    expect(items.find(d => d.id === ctx.nullDocId)).toBeUndefined();
  });

  it("control: a member of the owning project CAN access the project documents route", async () => {
    const res = await supertest(app).get(`/api/projects/${ctx.projectAId}/documents`).set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(200);
  });
});
