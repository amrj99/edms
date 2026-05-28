/**
 * authorization.test.ts
 *
 * Security regression suite — Authorization boundaries.
 *
 * These tests verify that every role-protected endpoint:
 *   1. Returns 401 when no token is provided
 *   2. Returns 403 when a token with insufficient role is provided
 *   3. Returns 2xx (or at least NOT 401/403) when the correct role is used
 *
 * ── Coverage ──────────────────────────────────────────────────────────────────
 *
 *   requireSysOwner  → system_owner only endpoints
 *   requireMinRole   → admin+, project_manager+, etc.
 *
 * ── Important ─────────────────────────────────────────────────────────────────
 *
 * These tests do NOT need a real DB for the 401/403 cases — the auth middleware
 * rejects before any DB call is made. We still import the app normally so the
 * full middleware chain runs.
 *
 * For tests that need DB state (e.g. "admin CAN see shadow-log") use factories.
 */

import { describe, it, expect } from "vitest";
import { api, tokens } from "./helpers/index.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

async function expectForbidden(
  method: "get" | "post" | "put" | "delete" | "patch",
  path: string,
  headers: Record<string, string>,
  expectedStatus: 401 | 403,
) {
  const res = await api()[method](path).set(headers);
  expect(res.status, `${method.toUpperCase()} ${path} should return ${expectedStatus}`).toBe(expectedStatus);
  expect(res.body.error).toBeDefined();
}

async function expectNotForbidden(
  method: "get" | "post" | "put" | "delete" | "patch",
  path: string,
  headers: Record<string, string>,
) {
  const res = await api()[method](path).set(headers);
  expect(
    res.status,
    `${method.toUpperCase()} ${path} should NOT return 401/403 for authorized role`,
  ).not.toBeOneOf([401, 403]);
}

// ─── requireSysOwner — system_owner ONLY endpoints ───────────────────────────

describe("requireSysOwner — system_owner only endpoints", () => {

  const sysOwnerEndpoints: Array<{ method: "get" | "post" | "put" | "delete"; path: string }> = [
    { method: "get",  path: "/api/admin/system-info" },
    { method: "get",  path: "/api/admin/org-plans" },
    { method: "put",  path: "/api/admin/ai-tier/1" },
  ];

  describe("returns 401 with no token", () => {
    it.each(sysOwnerEndpoints)("$method $path → 401", async ({ method, path }) => {
      await expectForbidden(method, path, {}, 401);
    });
  });

  describe("returns 403 for admin (not system_owner)", () => {
    it.each(sysOwnerEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.admin(), 403);
    });
  });

  describe("returns 403 for project_manager", () => {
    it.each(sysOwnerEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.projectManager(), 403);
    });
  });

  describe("returns 403 for reviewer", () => {
    it.each(sysOwnerEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.reviewer(), 403);
    });
  });

  // system_owner should NOT get 401/403
  describe("allows system_owner", () => {
    it.each(sysOwnerEndpoints)("$method $path → not 401/403", async ({ method, path }) => {
      await expectNotForbidden(method, path, tokens.systemOwner());
    });
  });
});

// ─── requireMinRole("admin") endpoints ───────────────────────────────────────

describe("requireMinRole(admin) — admin+ endpoints", () => {

  const adminEndpoints: Array<{ method: "get" | "post" | "put" | "delete"; path: string }> = [
    { method: "post",   path: "/api/users" },
    { method: "post",   path: "/api/departments" },
    { method: "get",    path: "/api/admin/shadow-log" },
    { method: "post",   path: "/api/admin/smtp/test" },
    { method: "post",   path: "/api/admin/search/reindex" },
    { method: "put",    path: "/api/admin/ai-classification" },
    { method: "post",   path: "/api/admin/seed-test-data" },
  ];

  describe("returns 401 with no token", () => {
    it.each(adminEndpoints)("$method $path → 401", async ({ method, path }) => {
      await expectForbidden(method, path, {}, 401);
    });
  });

  describe("returns 403 for project_manager", () => {
    it.each(adminEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.projectManager(), 403);
    });
  });

  describe("returns 403 for reviewer", () => {
    it.each(adminEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.reviewer(), 403);
    });
  });

  describe("returns 403 for member", () => {
    it.each(adminEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.member(), 403);
    });
  });

  describe("returns 403 for viewer", () => {
    it.each(adminEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.viewer(), 403);
    });
  });

  // admin and system_owner should NOT get 401/403
  describe("allows admin", () => {
    it.each(adminEndpoints)("$method $path → not 401/403", async ({ method, path }) => {
      await expectNotForbidden(method, path, tokens.admin());
    });
  });

  describe("allows system_owner (rank > admin)", () => {
    it.each(adminEndpoints)("$method $path → not 401/403", async ({ method, path }) => {
      await expectNotForbidden(method, path, tokens.systemOwner());
    });
  });
});

// ─── requireMinRole("project_manager") endpoints ─────────────────────────────

describe("requireMinRole(project_manager) — PM+ endpoints", () => {

  const pmEndpoints: Array<{ method: "get" | "post" | "put" | "delete"; path: string }> = [
    { method: "post",   path: "/api/rules" },
    { method: "post",   path: "/api/delegations" },
  ];

  describe("returns 401 with no token", () => {
    it.each(pmEndpoints)("$method $path → 401", async ({ method, path }) => {
      await expectForbidden(method, path, {}, 401);
    });
  });

  describe("returns 403 for reviewer", () => {
    it.each(pmEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.reviewer(), 403);
    });
  });

  describe("returns 403 for member", () => {
    it.each(pmEndpoints)("$method $path → 403", async ({ method, path }) => {
      await expectForbidden(method, path, tokens.member(), 403);
    });
  });

  // PM, admin, system_owner should pass
  describe("allows project_manager", () => {
    it.each(pmEndpoints)("$method $path → not 401/403", async ({ method, path }) => {
      await expectNotForbidden(method, path, tokens.projectManager());
    });
  });

  describe("allows admin (rank > PM)", () => {
    it.each(pmEndpoints)("$method $path → not 401/403", async ({ method, path }) => {
      await expectNotForbidden(method, path, tokens.admin());
    });
  });
});

// ─── Critical admin-vs-sysowner boundary ─────────────────────────────────────
//
// This is the most important boundary in the system:
// admin MUST NOT be able to perform system_owner actions.

describe("CRITICAL: admin cannot perform system_owner actions", () => {

  it("admin cannot view system-info", async () => {
    const res = await api()
      .get("/api/admin/system-info")
      .set(tokens.admin());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("admin cannot change org plans", async () => {
    const res = await api()
      .post("/api/admin/organizations/1/change-plan")
      .set(tokens.admin())
      .send({ planId: 1 });
    expect(res.status).toBe(403);
  });

  it("admin cannot change AI tier for an org", async () => {
    const res = await api()
      .put("/api/admin/ai-tier/1")
      .set(tokens.admin())
      .send({ tier: "pro" });
    expect(res.status).toBe(403);
  });

  it("admin cannot restore from backup", async () => {
    const res = await api()
      .post("/api/admin/restore")
      .set(tokens.admin())
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─── No token → always 401 (not 403 or 500) ──────────────────────────────────
//
// Regression: some old endpoints returned 500 when req.user was undefined
// instead of failing early in auth middleware.

describe("No token returns 401 (not 500)", () => {

  const protectedEndpoints = [
    { method: "get" as const,    path: "/api/admin/system-info" },
    { method: "get" as const,    path: "/api/admin/shadow-log" },
    { method: "get" as const,    path: "/api/users" },
    { method: "get" as const,    path: "/api/projects" },
    { method: "get" as const,    path: "/api/departments" },
    { method: "post" as const,   path: "/api/delegations" },
  ];

  it.each(protectedEndpoints)("$method $path → 401", async ({ method, path }) => {
    const res = await api()[method](path);
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });
});
