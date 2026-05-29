/**
 * billing.test.ts
 *
 * Plan & Module Enforcement Suite
 *
 * Verifies that requireModule() gates work correctly end-to-end:
 * an org whose plan does NOT include a module must receive 403,
 * and an org whose plan DOES include the module must receive 200 (or 201).
 *
 * ── Modules under test ────────────────────────────────────────────────────────
 *
 *   correspondence  — /api/correspondence, /api/projects/:id/correspondence
 *   meetings        — /api/meetings
 *   workflow_engine — /api/workflow-engine/templates
 *   chat            — /api/chat  (existing gate — regression)
 *   registers       — /api/projects/:id/registers  (existing gate — regression)
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *
 *   For each module we test two orgs:
 *     • "disabled" org  — org_config.modules[module] = false  → expect 403
 *     • "enabled"  org  — org_config.modules[module] = true   → expect NOT 403
 *       (may be 200, 201, or 404 depending on whether seed data exists,
 *        but NEVER 403 MODULE_DISABLED)
 *
 *   We insert org_config rows directly (bypassing ModuleSyncService) so the
 *   tests are deterministic and do not depend on plan lookup logic.
 *
 * ── Security contract ─────────────────────────────────────────────────────────
 *
 *   403 with { error: "MODULE_DISABLED" } is the ONLY acceptable response for
 *   a disabled module.  Any 2xx leaks access that should be blocked.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { makeToken } from "./helpers/auth.js";
import { orgConfigTable } from "@workspace/db";

// ─── Helper: build Authorization header from a DB user row ────────────────────

function bearerFor(user: { id: number; organizationId: number | null; role: string; email: string }): Record<string, string> {
  const token = makeToken({
    id: user.id,
    email: user.email,
    role: user.role as any,
    organizationId: user.organizationId!,
  });
  return { Authorization: `Bearer ${token}` };
}

// ─── Helper: insert org_config with explicit module flags ──────────────────────

async function seedOrgConfig(
  orgId: number,
  modules: Record<string, boolean>,
): Promise<void> {
  const db = getTestDb();
  await db.insert(orgConfigTable).values({
    organizationId: orgId,
    modules,
    aiEnabled: false,
    aiPrivacyMode: false,
  });
}

// ─── Full module flags (all enabled) ──────────────────────────────────────────

const ALL_MODULES_ENABLED: Record<string, boolean> = {
  dashboard:       true,
  deliverables:    true,
  registers:       true,
  notifications:   true,
  chat:            true,
  correspondence:  true,
  meetings:        true,
  workflow_engine: true,
};

// ─── Shared fixture ───────────────────────────────────────────────────────────

interface Fixture {
  // Orgs with individual modules disabled
  orgNoCorrespondence: { id: number };
  orgNoMeetings:       { id: number };
  orgNoWorkflow:       { id: number };
  orgNoChat:           { id: number };
  orgNoRegisters:      { id: number };

  // Org with all modules enabled (positive-path tests)
  orgFullAccess: { id: number };

  // Users (admin role so role-checks pass — we want to test module gates only)
  userNoCorrespondence: { id: number; organizationId: number | null; role: string; email: string };
  userNoMeetings:       { id: number; organizationId: number | null; role: string; email: string };
  userNoWorkflow:       { id: number; organizationId: number | null; role: string; email: string };
  userNoChat:           { id: number; organizationId: number | null; role: string; email: string };
  userNoRegisters:      { id: number; organizationId: number | null; role: string; email: string };
  userFullAccess:       { id: number; organizationId: number | null; role: string; email: string };

  // A project for the full-access org (needed for project-scoped routes)
  projectFull: { id: number };
  // A project for the no-registers org
  projectNoRegisters: { id: number };
}

let fx: Fixture;

beforeAll(async () => {
  await truncateAllTables();

  // ── Create orgs ────────────────────────────────────────────────────────────
  const orgNoCorrespondence = await createOrg({ name: "No Correspondence Org", code: "NOCORR" });
  const orgNoMeetings       = await createOrg({ name: "No Meetings Org",       code: "NOMEET" });
  const orgNoWorkflow       = await createOrg({ name: "No Workflow Org",       code: "NOWFLOW" });
  const orgNoChat           = await createOrg({ name: "No Chat Org",           code: "NOCHAT" });
  const orgNoRegisters      = await createOrg({ name: "No Registers Org",      code: "NOREG" });
  const orgFullAccess       = await createOrg({ name: "Full Access Org",       code: "FULL" });

  // ── Seed org_config rows ───────────────────────────────────────────────────
  await seedOrgConfig(orgNoCorrespondence.id, { ...ALL_MODULES_ENABLED, correspondence: false });
  await seedOrgConfig(orgNoMeetings.id,       { ...ALL_MODULES_ENABLED, meetings: false });
  await seedOrgConfig(orgNoWorkflow.id,       { ...ALL_MODULES_ENABLED, workflow_engine: false });
  await seedOrgConfig(orgNoChat.id,           { ...ALL_MODULES_ENABLED, chat: false });
  await seedOrgConfig(orgNoRegisters.id,      { ...ALL_MODULES_ENABLED, registers: false });
  await seedOrgConfig(orgFullAccess.id,       ALL_MODULES_ENABLED);

  // ── Create one admin user per org ──────────────────────────────────────────
  const userNoCorrespondence = await createUser({ organizationId: orgNoCorrespondence.id, role: "admin", email: "u@nocorr.test" });
  const userNoMeetings       = await createUser({ organizationId: orgNoMeetings.id,       role: "admin", email: "u@nomeet.test" });
  const userNoWorkflow       = await createUser({ organizationId: orgNoWorkflow.id,       role: "admin", email: "u@nowflow.test" });
  const userNoChat           = await createUser({ organizationId: orgNoChat.id,           role: "admin", email: "u@nochat.test" });
  const userNoRegisters      = await createUser({ organizationId: orgNoRegisters.id,      role: "admin", email: "u@noreg.test" });
  const userFullAccess       = await createUser({ organizationId: orgFullAccess.id,       role: "admin", email: "u@full.test" });

  // ── Create projects ────────────────────────────────────────────────────────
  const projectFull       = await createProject({ organizationId: orgFullAccess.id });
  const projectNoRegisters = await createProject({ organizationId: orgNoRegisters.id });

  fx = {
    orgNoCorrespondence, orgNoMeetings, orgNoWorkflow, orgNoChat, orgNoRegisters, orgFullAccess,
    userNoCorrespondence, userNoMeetings, userNoWorkflow, userNoChat, userNoRegisters, userFullAccess,
    projectFull, projectNoRegisters,
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── correspondence module ─────────────────────────────────────────────────────

describe("Module gate — correspondence", () => {
  it("blocks GET /correspondence when module is disabled → 403 MODULE_DISABLED", async () => {
    const res = await api()
      .get("/api/correspondence")
      .set(bearerFor(fx.userNoCorrespondence));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
    expect(res.body.module).toBe("correspondence");
  });

  it("blocks GET /projects/:id/correspondence when module is disabled → 403", async () => {
    const project = await createProject({ organizationId: fx.orgNoCorrespondence.id });

    const res = await api()
      .get(`/api/projects/${project.id}/correspondence`)
      .set(bearerFor(fx.userNoCorrespondence));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
  });

  it("allows GET /correspondence when module is enabled → not 403", async () => {
    const res = await api()
      .get("/api/correspondence")
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
    // May be 200 (empty list) or other non-403
    expect([200, 201, 404]).toContain(res.status);
  });

  it("allows GET /projects/:id/correspondence when module is enabled → not 403", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectFull.id}/correspondence`)
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
  });
});

// ─── meetings module ───────────────────────────────────────────────────────────

describe("Module gate — meetings", () => {
  it("blocks GET /meetings when module is disabled → 403 MODULE_DISABLED", async () => {
    const res = await api()
      .get("/api/meetings")
      .set(bearerFor(fx.userNoMeetings));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
    expect(res.body.module).toBe("meetings");
  });

  it("blocks POST /meetings when module is disabled → 403", async () => {
    const res = await api()
      .post("/api/meetings")
      .set(bearerFor(fx.userNoMeetings))
      .send({ title: "Test Meeting", projectId: 1, scheduledAt: new Date().toISOString() });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
  });

  it("allows GET /meetings when module is enabled → not 403", async () => {
    const res = await api()
      .get("/api/meetings")
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
    expect([200, 201, 404]).toContain(res.status);
  });
});

// ─── workflow_engine module ────────────────────────────────────────────────────

describe("Module gate — workflow_engine", () => {
  it("blocks GET /workflow-engine/templates when module is disabled → 403 MODULE_DISABLED", async () => {
    const res = await api()
      .get("/api/workflow-engine/templates")
      .set(bearerFor(fx.userNoWorkflow));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
    expect(res.body.module).toBe("workflow_engine");
  });

  it("blocks POST /workflow-engine/templates when module is disabled → 403", async () => {
    const res = await api()
      .post("/api/workflow-engine/templates")
      .set(bearerFor(fx.userNoWorkflow))
      .send({ name: "Test Workflow", description: "blocked" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
  });

  it("allows GET /workflow-engine/templates when module is enabled → not 403", async () => {
    const res = await api()
      .get("/api/workflow-engine/templates")
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
    expect([200, 201, 404]).toContain(res.status);
  });
});

// ─── chat module (regression — gate was pre-existing) ─────────────────────────

describe("Module gate — chat (regression)", () => {
  it("blocks GET /chat when module is disabled → 403 MODULE_DISABLED", async () => {
    const res = await api()
      .get("/api/chat")
      .set(bearerFor(fx.userNoChat));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
    expect(res.body.module).toBe("chat");
  });

  it("allows GET /chat when module is enabled → not 403", async () => {
    const res = await api()
      .get("/api/chat")
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
  });
});

// ─── registers module (regression — gate was pre-existing) ────────────────────

describe("Module gate — registers (regression)", () => {
  it("blocks project-scoped registers route when module is disabled → 403 MODULE_DISABLED", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectNoRegisters.id}/registers`)
      .set(bearerFor(fx.userNoRegisters));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MODULE_DISABLED");
    expect(res.body.module).toBe("registers");
  });

  it("allows project-scoped registers route when module is enabled → not 403", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectFull.id}/registers`)
      .set(bearerFor(fx.userFullAccess));

    expect(res.status).not.toBe(403);
  });
});

// ─── Unauthenticated requests pass through requireModule (handled by requireAuth) ──

describe("Module gate — unauthenticated passthrough", () => {
  it("unauthenticated request to disabled module → 401 (not 403 MODULE_DISABLED)", async () => {
    // requireModule passes through when no JWT is present.
    // requireAuth in the sub-router then returns 401.
    const res = await api().get("/api/correspondence");

    expect(res.status).toBe(401);
    expect(res.body.error).not.toBe("MODULE_DISABLED");
  });
});
