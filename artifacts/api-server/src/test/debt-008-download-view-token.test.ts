/**
 * debt-008-download-view-token.test.ts
 *
 * DEBT-008 regression: a view-token minted for the ACTUAL R2/S3 serve URL (as the
 * frontend does) must authorize a download over a bare browser navigation (no
 * Authorization header) — while still being strictly bound to that one object.
 *
 * Root cause under test (to be PROVEN before the fix, not assumed): the serve URL
 * built by r2ServeUrl/s3ServeUrl is
 *     /api/storage/r2-object/<percent-encoded-key>?orgId=<n>
 * but the serve route's expectedPathFn produces the DECODED path with NO query
 *     /api/storage/r2-object/<decoded/key>
 * The middleware compares payload.url !== expectedPath verbatim, so a token minted
 * for the real serve URL never matches → 403, even though the token is valid and
 * for the right object. On-premise serve URLs carry no query, so they were unaffected.
 *
 * The fix canonicalises BOTH sides (drop query, percent-decode, normalise slashes)
 * via canonicalizeStorageServeUrl — the SAME identity function the soft-delete guard
 * uses. Binding MUST stay strict: a token for file A must not download file B, and
 * changing orgId / object key must not pass. Negative tests below pin that.
 *
 * NOTE ON EVIDENCE: this is an integration test through the real route. It does NOT
 * send an Authorization header, so it faithfully models a browser NAVIGATION (the
 * real download path) — unlike an in-page fetch, which the app wraps to inject Bearer.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { api, createOrg, createUser, truncateAllTables } from "./helpers/index.js";
import { signToken } from "../lib/auth.js";
import { r2ServeUrl, s3ServeUrl } from "../lib/orgStorage.js";

interface Fx { orgA: { id: number }; orgB: { id: number }; adminA: { id: number }; keyA: string; keyB: string; serveA: string; }
let fx: Fx;
const saved: Record<string, string | undefined> = {};

/** Mint a view_file token bound to a given URL string (mirrors GET /view-token). */
function viewTokenFor(url: string, orgId: number, userId: number): string {
  return signToken({ type: "view_file", url, userId, orgId, role: "admin" }, 300);
}
/** Bare navigation download: NO Authorization header, token only via ?vt / &vt. */
function navDownload(serveUrl: string, vt?: string) {
  const sep = serveUrl.includes("?") ? "&" : "?";
  return api().get(vt ? `${serveUrl}${sep}vt=${vt}` : serveUrl);
}

beforeAll(async () => {
  await truncateAllTables();
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY"]) saved[k] = process.env[k];
  process.env.R2_ENDPOINT = "https://fake-account.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "edms-files-test";
  process.env.R2_ACCESS_KEY = "test-access-key";
  process.env.R2_SECRET_KEY = "test-secret-key";

  const orgA = await createOrg({ name: "DL Org A", code: "DL0A" });
  const orgB = await createOrg({ name: "DL Org B", code: "DL0B" });
  const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "a@dl0a.test" });
  const keyA = `org_${orgA.id}/projects/16/1699_report.pdf`;
  const keyB = `org_${orgA.id}/projects/16/1700_other.pdf`;
  fx = { orgA, orgB, adminA, keyA, keyB, serveA: r2ServeUrl(orgA.id, keyA) };
});
afterAll(async () => {
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY"]) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  await truncateAllTables();
});

describe("DEBT-008 — cause proof: representation mismatch, not the token itself", () => {
  it("CONTROL: a token minted for the DECODED path (no query) is accepted → 302 (reaches handler)", async () => {
    // Proves the token machinery works; the ONLY variable that breaks the realistic
    // case is the URL representation (encoded key + ?orgId).
    const decodedPath = `/api/storage/r2-object/${fx.keyA}`; // decoded, no query — matches expectedPathFn
    const vt = viewTokenFor(decodedPath, fx.orgA.id, fx.adminA.id);
    const res = await navDownload(fx.serveA, vt);
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(302);
    expect(res.headers.location).toContain("r2.cloudflarestorage.com");
  });
});

describe("DEBT-008 — desired behavior (regression): download via the REAL serve URL's view-token", () => {
  it("token minted for the actual r2ServeUrl (encoded key + ?orgId) authorizes the download → 302", async () => {
    // This is exactly what GET /view-token signs (url = the stored serveUrl).
    const vt = viewTokenFor(fx.serveA, fx.orgA.id, fx.adminA.id);
    const res = await navDownload(fx.serveA, vt);
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(302);
    expect(res.headers.location).toContain("r2.cloudflarestorage.com");
  });

  it("bare navigation without any view-token → 401 (models the current UI failure)", async () => {
    const res = await navDownload(fx.serveA);
    expect(res.status).toBe(401);
  });
});

describe("DEBT-008 — binding stays strict (negative tests: no over-canonicalisation)", () => {
  it("token for file A cannot download file B (different key)", async () => {
    const vtA = viewTokenFor(r2ServeUrl(fx.orgA.id, fx.keyA), fx.orgA.id, fx.adminA.id);
    const serveB = r2ServeUrl(fx.orgA.id, fx.keyB);
    const res = await navDownload(serveB, vtA); // present A's token on B's URL
    expect(res.status).not.toBe(302);
    expect([401, 403]).toContain(res.status);
    expect(res.headers.location).toBeUndefined();
  });

  it("changing the object key in the request path (token bound to A) is rejected", async () => {
    const vtA = viewTokenFor(fx.serveA, fx.orgA.id, fx.adminA.id);
    const tampered = `/api/storage/r2-object/${encodeURIComponent(`org_${fx.orgA.id}/projects/16/EVIL.pdf`)}?orgId=${fx.orgA.id}`;
    const res = await navDownload(tampered, vtA);
    expect(res.status).not.toBe(302);
    expect(res.headers.location).toBeUndefined();
  });

  it("changing orgId to another tenant (cross-tenant key) with A's token is rejected", async () => {
    const vtA = viewTokenFor(fx.serveA, fx.orgA.id, fx.adminA.id);
    const crossKey = `org_${fx.orgB.id}/projects/16/1699_report.pdf`;
    const crossServe = r2ServeUrl(fx.orgB.id, crossKey);
    const res = await navDownload(crossServe, vtA);
    expect(res.status).not.toBe(302);
    expect(res.headers.location).toBeUndefined();
  });

  it("an invalid/garbage view-token is rejected", async () => {
    const res = await navDownload(fx.serveA, "not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("DEBT-008 — shared middleware: S3 fixed, on-premise not regressed", () => {
  it("S3: token minted for the real s3ServeUrl passes the view-token check (no longer 403)", async () => {
    // s3-object uses the same encoded-key + ?orgId serve URL and the same middleware.
    // Before the fix this 403'd on representation mismatch; now the vt check passes and
    // the request reaches the handler (which returns non-2xx only because no per-org S3
    // bucket is configured in the test — NOT an auth rejection).
    const key = `${fx.orgA.id}/16/document/1701_s3file.pdf`; // per-org S3 key shape
    const serveS3 = s3ServeUrl(fx.orgA.id, key);
    const vt = viewTokenFor(serveS3, fx.orgA.id, fx.adminA.id);
    const res = await navDownload(serveS3, vt);
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).not.toBe(403); // vt accepted
    expect(res.status).not.toBe(401);
  });

  it("on-premise: token for the plain serve URL still passes (no query → unaffected by canonicalisation)", async () => {
    const serveOnp = `/api/storage/onpremise/${fx.orgA.id}/16/document/1702_onp.pdf`;
    const vt = viewTokenFor(serveOnp, fx.orgA.id, fx.adminA.id);
    const res = await navDownload(serveOnp, vt);
    // vt accepted (not an auth rejection); file doesn't exist on disk → 404, which is fine.
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("on-premise: a token for onprem file A cannot fetch onprem file B (binding still strict)", async () => {
    const serveA = `/api/storage/onpremise/${fx.orgA.id}/16/document/1702_onp.pdf`;
    const serveB = `/api/storage/onpremise/${fx.orgA.id}/16/document/OTHER_onp.pdf`;
    const vtA = viewTokenFor(serveA, fx.orgA.id, fx.adminA.id);
    const res = await navDownload(serveB, vtA);
    expect(res.status).toBe(403); // different object path → mismatch
  });
});
