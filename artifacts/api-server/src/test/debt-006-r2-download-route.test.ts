/**
 * debt-006-r2-download-route.test.ts
 *
 * DEBT-006 regression: GET /api/storage/r2-object/<key> must serve R2 objects and
 * must NOT 404 when the object key contains slashes.
 *
 * Root cause (proven): behind nginx, proxy_pass normalises the URI and decodes
 * %2F → the object key reaches the API with RAW slashes. The old single-segment
 * ":objectKey" route could not match a multi-slash path → 404 "Cannot GET". The
 * route now uses a splat ("*objectKey") and rejoins the segments.
 *
 * This test also pins the authorization/isolation on the download route so the
 * 404 fix does not open an IDOR:
 *   - unauthenticated              → 401
 *   - owner (same tenant)          → 302 redirect to a presigned URL
 *   - other tenant via ?orgId=A    → 403 (assertOrgAccess denies)
 *   - other tenant via key prefix  → 403 (knowing the key is not enough)
 *   - encoded (%2F) direct request → also matches (302)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { api, authHeader, createOrg, createUser, truncateAllTables } from "./helpers/index.js";

interface Fx { orgA: { id: number }; orgB: { id: number }; adminA: { id: number }; adminB: { id: number }; keyA: string; }
let fx: Fx;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  await truncateAllTables();
  // Make isR2Configured() true so the handler reaches the ownership/serve logic.
  // Presigning is local (no network), so fake credentials are fine.
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY"]) saved[k] = process.env[k];
  process.env.R2_ENDPOINT = "https://fake-account.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "edms-files-test";
  process.env.R2_ACCESS_KEY = "test-access-key";
  process.env.R2_SECRET_KEY = "test-secret-key";

  const orgA = await createOrg({ name: "R2 Owner A", code: "R2OWNA" });
  const orgB = await createOrg({ name: "R2 Outsider B", code: "R2OUTB" });
  const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "a@r2owna.test" });
  const adminB = await createUser({ organizationId: orgB.id, role: "admin", email: "b@r2outb.test" });
  fx = { orgA, orgB, adminA, adminB, keyA: `org_${orgA.id}/projects/0/1787_debt006-file.png` };
});
afterAll(async () => {
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY"]) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  await truncateAllTables();
});

const hA = () => authHeader("admin", fx.adminA.id, fx.orgA.id, "a@r2owna.test");
const hB = () => authHeader("admin", fx.adminB.id, fx.orgB.id, "b@r2outb.test");

describe("DEBT-006 — /api/storage/r2-object serves slash-containing keys (no 404)", () => {
  it("RAW slashes (nginx-decoded) + owner → 302 redirect (route matches, served)", async () => {
    const res = await api().get(`/api/storage/r2-object/${fx.keyA}?orgId=${fx.orgA.id}`).set(hA());
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(302);
    expect(res.headers.location).toContain("r2.cloudflarestorage.com");
    // Must NOT be the Express route-miss 404
    expect(res.status).not.toBe(404);
  });

  it("ENCODED %2F (direct-to-API) + owner → 302 (route also matches)", async () => {
    const encoded = encodeURIComponent(fx.keyA);
    const res = await api().get(`/api/storage/r2-object/${encoded}?orgId=${fx.orgA.id}`).set(hA());
    expect(res.status).toBe(302);
  });
});

describe("DEBT-006 — download authorization / tenant isolation preserved", () => {
  it("unauthenticated → 401", async () => {
    const res = await api().get(`/api/storage/r2-object/${fx.keyA}?orgId=${fx.orgA.id}`);
    expect(res.status).toBe(401);
  });

  it("other tenant claiming ?orgId=A → 403 (cannot access org A)", async () => {
    const res = await api().get(`/api/storage/r2-object/${fx.keyA}?orgId=${fx.orgA.id}`).set(hB());
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  it("other tenant knowing the key (orgId derived from key prefix) → 403", async () => {
    // No ?orgId — orgId is derived from the org_A/ prefix; assertOrgAccess must still deny B.
    const res = await api().get(`/api/storage/r2-object/${fx.keyA}`).set(hB());
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });
});
