/**
 * backfill-orgscope-behavior.test.ts
 *
 * Demonstrates the FUNCTIONAL effect the documents-org backfill fixes.
 *
 * The three document action endpoints (submit-review, archive, obsolete) scope
 * their write with orgScopedWhere = eq(id) AND eq(organization_id, caller.org).
 * There is no NULL branch, so a legacy document whose organization_id IS NULL
 * never matches — the rightful project owner gets 404 ("Not Found") on those
 * actions. After the backfill sets organization_id = project owner, the same
 * call succeeds. This test proves both halves on the REAL app + middleware,
 * using PATCH /:id/archive as the representative endpoint.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db, organizationsTable, usersTable, projectsTable, projectMembersTable, documentsTable,
} from "@workspace/db";
import { signToken } from "../lib/auth.js";
import { truncateAllTables } from "./helpers/index.js";
import app from "../app.js";

const FAKE_HASH = "$2b$12$testplaceholder00000000000000000000000000000000000000000";

interface Ctx { projectId: number; docId: number; ownerOrgId: number; adminToken: string; }

async function buildCtx(): Promise<Ctx> {
  const [org] = await db.insert(organizationsTable).values({ name: "Backfill Org", type: "consultant", subscriptionTier: "professional" }).returning();
  const [admin] = await db.insert(usersTable).values({
    email: `bf-admin-${Date.now()}@test.local`, firstName: "Ad", lastName: "Min",
    passwordHash: FAKE_HASH, role: "admin", organizationId: org.id, isActive: true, mustChangePassword: false,
  }).returning();
  const [project] = await db.insert(projectsTable).values({ name: "Backfill Project", code: `BF-${Date.now()}`, organizationId: org.id, status: "active" }).returning();
  await db.insert(projectMembersTable).values({ projectId: project.id, userId: admin.id, role: "admin" });
  // Legacy shape: a document in an owned project with organization_id = NULL.
  const [doc] = await db.insert(documentsTable).values({
    projectId: project.id, organizationId: null,
    documentNumber: `BF-DOC-${Date.now()}`, title: "Backfill target", revision: "A", status: "draft", createdById: admin.id,
  }).returning();

  return {
    projectId: project.id, docId: doc.id, ownerOrgId: org.id,
    adminToken: signToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id }),
  };
}

let ctx: Ctx;
beforeEach(async () => { await truncateAllTables(); ctx = await buildCtx(); });
afterEach(async () => { await truncateAllTables(); });

const archive = () =>
  supertest(app)
    .patch(`/api/projects/${ctx.projectId}/documents/${ctx.docId}/archive`)
    .set("Authorization", `Bearer ${ctx.adminToken}`)
    .send({ reason: "backfill behavior check" });

describe("orgScopedWhere document action — NULL org before backfill, works after", () => {
  it("returns 404 for the rightful owner while the document is NULL-org (the legacy bug)", async () => {
    const res = await archive();
    expect(res.status).toBe(404);
  });

  it("succeeds once organization_id is backfilled to the project owner", async () => {
    // Simulate exactly what the backfill does: documents.organization_id = project owner.
    await db.update(documentsTable).set({ organizationId: ctx.ownerOrgId }).where(eq(documentsTable.id, ctx.docId));

    const res = await archive();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });
});
