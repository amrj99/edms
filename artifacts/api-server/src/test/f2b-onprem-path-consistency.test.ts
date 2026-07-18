/**
 * f2b-onprem-path-consistency.test.ts
 *
 * CONSISTENCY FIX (F2b) — not an architecture decision.
 *
 * Four layers already encode a missing project as "0" in the storage path: the
 * serve-URL builder, the upload-URL builder, the onpremise PUT handler, and the
 * R2 key builder. Only the on-prem PATH builder diverged — a truthiness check
 * `if (projectId)` dropped the segment for null/0, producing a 3-segment path
 * while files are actually written/served at the 4-segment path. That divergence
 * is exactly what made some legacy files unretrievable (finding F2).
 *
 * DESIGN NOTE (why this drives the real public API, not a helper):
 * the path/key builders are module-INTERNAL. Rather than widening orgStorage's
 * surface just to unit-test them, we assert the contract through the real usage
 * point requestUpload() — the exact pattern org-storage-config.test.ts uses.
 * requestUpload() returns filePath (physical write path), serveUrl (the stored
 * retrieval URL) and objectPath (the R2 key), so one real call lets us prove all
 * layers agree on the SAME projectId end-to-end. Stronger than a synthetic unit
 * assertion, and zero test-only exports.
 *
 * NOTE: "0" here only mirrors the current behaviour of the other layers; it is
 * NOT a ratified long-term "no project" contract — that decision stays open.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createOrg, truncateAllTables } from "./helpers/index.js";
import { requestUpload } from "../lib/orgStorage.js";
import os from "os";
import path from "path";

const ORIGINAL_ENV = {
  DEFAULT_STORAGE_TYPE: process.env.DEFAULT_STORAGE_TYPE,
  DEFAULT_STORAGE_PATH: process.env.DEFAULT_STORAGE_PATH,
  PRIVATE_OBJECT_DIR: process.env.PRIVATE_OBJECT_DIR,
  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
  R2_SECRET_KEY: process.env.R2_SECRET_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Model the onpremise serve route (routes/storage.ts): it path.join()s the base
 * path with the URL segments {org}/{proj}/{type}/{file} taken straight from the
 * serve URL. So the physical path a serve-URL resolves to, for a given base, is
 * derived here from the ACTUAL serveUrl the adapter produced — never a synthetic
 * string that could drift from what the adapter writes.
 */
function servePathFromServeUrl(basePath: string, serveUrl: string): string {
  const rel = serveUrl.replace("/api/storage/onpremise/", "");
  return path.join(basePath, ...rel.split("/"));
}

beforeAll(async () => {
  await truncateAllTables();
});

afterEach(() => {
  restoreEnv();
});

afterAll(async () => {
  restoreEnv();
  await truncateAllTables();
});

describe("F2b — storage path layers are internally consistent (via requestUpload)", () => {
  it("on-prem: write path, serve URL and serve path all agree on a real projectId=15", async () => {
    const org = await createOrg({ name: "F2b OnPrem 15", code: "F2BOP15" });
    const base = path.join(os.tmpdir(), `f2b-onprem-${org.id}`);
    process.env.DEFAULT_STORAGE_TYPE = "onpremise";
    process.env.DEFAULT_STORAGE_PATH = base;
    delete process.env.PRIVATE_OBJECT_DIR;
    delete process.env.R2_ENDPOINT; // ensure R2 branch is not taken

    const r = await requestUpload({
      organizationId: org.id,
      projectId: 15,
      fileType: "document",
      name: "spec.pdf",
    });

    expect(r.mode).toBe("onpremise");
    const file = path.basename(r.filePath!);

    // (a) Write path (physical): 4 segments with the real projectId 15.
    expect(r.filePath).toBe(path.join(base, String(org.id), "15", "document", file));

    // (b) Serve URL: carries the same projectId 15 (never dropped to 0).
    expect(r.serveUrl).toBe(`/api/storage/onpremise/${org.id}/15/document/${file}`);

    // (c) Serve path == write path: the URL resolves back to exactly where the
    //     file was written. This is the semantic invariant the fix guarantees.
    expect(servePathFromServeUrl(base, r.serveUrl!)).toBe(r.filePath);
  });

  it("on-prem no-project: null encodes as 0 for write AND serve, and the old 3-segment shape does not recur", async () => {
    const org = await createOrg({ name: "F2b OnPrem null", code: "F2BOPN" });
    const base = path.join(os.tmpdir(), `f2b-onprem-null-${org.id}`);
    process.env.DEFAULT_STORAGE_TYPE = "onpremise";
    process.env.DEFAULT_STORAGE_PATH = base;
    delete process.env.PRIVATE_OBJECT_DIR;
    delete process.env.R2_ENDPOINT;

    const r = await requestUpload({
      organizationId: org.id,
      projectId: null,
      fileType: "document",
      name: "x.pdf",
    });

    expect(r.mode).toBe("onpremise");
    const file = path.basename(r.filePath!);

    expect(r.filePath).toBe(path.join(base, String(org.id), "0", "document", file));
    expect(r.serveUrl).toBe(`/api/storage/onpremise/${org.id}/0/document/${file}`);
    // Write path and serve path still agree in the no-project case.
    expect(servePathFromServeUrl(base, r.serveUrl!)).toBe(r.filePath);
    // Regression guard: the OLD 3-segment shape (the F2 root cause) must NOT recur.
    expect(r.serveUrl).not.toBe(`/api/storage/onpremise/${org.id}/document/${file}`);
    expect(r.filePath).not.toBe(path.join(base, String(org.id), "document", file));
  });

  it("R2: object key and serve URL agree on the same real projectId=15", async () => {
    const org = await createOrg({ name: "F2b R2 15", code: "F2BR215" });
    // Force the R2 branch; presigning is offline (local HMAC), no network needed.
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "test-bucket";
    process.env.R2_ACCESS_KEY = "AKIATESTACCESSKEY";
    process.env.R2_SECRET_KEY = "test-secret-access-key";
    delete process.env.DEFAULT_STORAGE_TYPE;
    delete process.env.PRIVATE_OBJECT_DIR;

    const r = await requestUpload({
      organizationId: org.id,
      projectId: 15,
      fileType: "document",
      name: "spec.pdf",
    });

    expect(r.mode).toBe("r2");
    // (a) R2 key: real projectId 15 in the canonical org_{id}/projects/{pid}/ slot.
    expect(r.objectPath).toMatch(new RegExp(`^org_${org.id}/projects/15/`));
    // (b) Serve URL encodes exactly that key — decoding it round-trips to the key.
    expect(r.serveUrl).toBe(
      `/api/storage/r2-object/${encodeURIComponent(r.objectPath!)}?orgId=${org.id}`,
    );
    const decoded = decodeURIComponent(r.serveUrl!.split("/r2-object/")[1].split("?")[0]);
    expect(decoded).toBe(r.objectPath);
    expect(decoded).toContain("/projects/15/");
  });

  it("R2 no-project: null encodes as projects/0 (mirrors the on-prem rule)", async () => {
    const org = await createOrg({ name: "F2b R2 null", code: "F2BR2N" });
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "test-bucket";
    process.env.R2_ACCESS_KEY = "AKIATESTACCESSKEY";
    process.env.R2_SECRET_KEY = "test-secret-access-key";
    delete process.env.DEFAULT_STORAGE_TYPE;
    delete process.env.PRIVATE_OBJECT_DIR;

    const r = await requestUpload({
      organizationId: org.id,
      projectId: null,
      fileType: "document",
      name: "x.pdf",
    });

    expect(r.mode).toBe("r2");
    expect(r.objectPath).toMatch(new RegExp(`^org_${org.id}/projects/0/`));
    expect(r.objectPath).not.toMatch(/projects\/15\//);
  });
});
