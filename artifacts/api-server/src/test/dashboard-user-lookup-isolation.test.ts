/**
 * dashboard-user-lookup-isolation.test.ts
 *
 * GET /api/dashboard enriches its (org-scoped) pending workflows with the
 * initiator's display name. The lookup previously ran `db.select().from(usersTable)`
 * — loading EVERY user across EVERY organization into memory to resolve at most 5
 * names. That is a tenant-isolation / defense-in-depth concern (cross-org PII pulled
 * into the handler) and a scale cost.
 *
 * The fix scopes the lookup to `inArray(usersTable.id, initiatorIds)` where the
 * initiator IDs come from the already org-scoped pending workflows (no extra org
 * filter — an authorized cross-org party initiator must still resolve).
 *
 * These tests assert:
 *   1. Org B's user PII (name + email) never appears anywhere in Org A's dashboard.
 *   2. The in-scope initiator name for Org A's own workflow still resolves (fix does
 *      not over-restrict).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import {
  db, organizationsTable, usersTable, projectsTable, documentsTable,
  wfTemplatesTable, wfInstancesTable,
} from "@workspace/db";
import { signToken } from "../lib/auth.js";
import { truncateAllTables } from "./helpers/index.js";
import app from "../app.js";

const FAKE_HASH = "$2b$12$testplaceholder00000000000000000000000000000000000000000";

// Distinctive Org B identity — must NEVER surface in Org A's dashboard.
const ORGB_FIRST = "Zzbravo";
const ORGB_LAST = "Isolationcheck";
const ORGB_EMAIL = "zzbravo.isolation@orgb-external.test";

interface Ctx { adminAId: number; adminAName: string; tokenA: string; }

async function buildCtx(): Promise<Ctx> {
  // ── Org A: admin initiates a pending workflow ───────────────────────────────
  const [orgA] = await db.insert(organizationsTable).values({
    name: "Dash Org A", type: "consultant", subscriptionTier: "professional",
  }).returning();
  const [adminA] = await db.insert(usersTable).values({
    email: `dash-a-${Date.now()}@test.local`, firstName: "Aaadmin", lastName: "Orga",
    passwordHash: FAKE_HASH, role: "admin", organizationId: orgA.id, isActive: true, mustChangePassword: false,
  }).returning();
  const [projectA] = await db.insert(projectsTable).values({
    name: "Dash Project A", code: `DPA-${Date.now()}`, organizationId: orgA.id, status: "active",
  }).returning();
  const [docA] = await db.insert(documentsTable).values({
    organizationId: orgA.id, projectId: projectA.id, createdById: adminA.id,
    documentNumber: `DPA-DOC-${Date.now()}`, title: "Dash Doc A", revision: "A", status: "draft",
  }).returning();
  const [tplA] = await db.insert(wfTemplatesTable).values({
    organizationId: orgA.id, name: "Dash Tpl A", documentType: "General", isActive: true, createdById: adminA.id,
  }).returning();
  await db.insert(wfInstancesTable).values({
    organizationId: orgA.id, projectId: projectA.id, documentId: docA.id, templateId: tplA.id,
    status: "active", initiatedById: adminA.id,
  });

  // ── Org B: an unrelated user whose PII must not leak ────────────────────────
  const [orgB] = await db.insert(organizationsTable).values({
    name: "Dash Org B", type: "consultant", subscriptionTier: "professional",
  }).returning();
  await db.insert(usersTable).values({
    email: ORGB_EMAIL, firstName: ORGB_FIRST, lastName: ORGB_LAST,
    passwordHash: FAKE_HASH, role: "admin", organizationId: orgB.id, isActive: true, mustChangePassword: false,
  }).returning();

  const tokenA = signToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
  return { adminAId: adminA.id, adminAName: "Aaadmin Orga", tokenA };
}

let ctx: Ctx;
beforeEach(async () => { await truncateAllTables(); ctx = await buildCtx(); });
afterEach(async () => { await truncateAllTables(); });

describe("Dashboard user lookup — tenant isolation", () => {
  it("Org A dashboard never contains Org B user's name or email", async () => {
    const res = await supertest(app).get("/api/dashboard").set("Authorization", `Bearer ${ctx.tokenA}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(ORGB_FIRST);
    expect(body).not.toContain(ORGB_LAST);
    expect(body).not.toContain(ORGB_EMAIL);
  });

  it("the in-scope initiator name for Org A's own pending workflow still resolves", async () => {
    const res = await supertest(app).get("/api/dashboard").set("Authorization", `Bearer ${ctx.tokenA}`);
    expect(res.status).toBe(200);
    const wfs = (res.body.pendingApprovals ?? res.body.pendingWorkflows ?? res.body.enrichedWorkflows ?? []) as any[];
    const mine = wfs.find(w => w.initiatedByName === ctx.adminAName);
    expect(mine, "Org A's own workflow initiator name must resolve after scoping").toBeDefined();
  });
});
