/**
 * debt-007-presign-no-checksum.test.ts
 *
 * DEBT-007 regression: presigned R2 PUT URLs must NOT carry the aws-sdk v3
 * flexible-checksum params.
 *
 * aws-sdk/client-s3 v3 defaults requestChecksumCalculation to "WHEN_SUPPORTED",
 * which bakes x-amz-checksum-crc32 (empty-body CRC32) + x-amz-sdk-checksum-algorithm
 * into presigned PUT URLs. Cloudflare R2 then rejects the browser PUT (preflight
 * 204 but the actual PUT fails with no ACAO → "Failed to fetch"), so uploads never
 * complete. The fix sets requestChecksumCalculation: "WHEN_REQUIRED" on the S3
 * clients so presigned PUTs are clean SigV4 (SignedHeaders=host, no checksum query).
 *
 * This drives the REAL code path (requestUpload → buildR2Client → getSignedUrl) and
 * asserts the produced upload URL is checksum-free. Presigning is local crypto, so
 * fake R2 credentials are sufficient (no network).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { requestUpload } from "../lib/orgStorage.js";
import { createOrg, truncateAllTables } from "./helpers/index.js";

const saved: Record<string, string | undefined> = {};
let orgId: number;

beforeAll(async () => {
  await truncateAllTables();
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY", "DEFAULT_STORAGE_TYPE"]) saved[k] = process.env[k];
  process.env.R2_ENDPOINT = "https://fake-account.r2.cloudflarestorage.com";
  process.env.R2_BUCKET = "edms-files-test";
  process.env.R2_ACCESS_KEY = "test-access-key";
  process.env.R2_SECRET_KEY = "test-secret-key";
  delete process.env.DEFAULT_STORAGE_TYPE;
  const org = await createOrg({ name: "Presign Org", code: "PRESN" });
  orgId = org.id;
});
afterAll(async () => {
  for (const k of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY", "DEFAULT_STORAGE_TYPE"]) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  await truncateAllTables();
});

describe("DEBT-007 — R2 presigned PUT URL is checksum-free", () => {
  it("requestUpload (R2) returns an uploadURL with NO flexible-checksum params", async () => {
    const res = await requestUpload({
      organizationId: orgId, projectId: 16, fileType: "document",
      name: "e2e.png", size: 128, contentType: "image/png",
    });
    expect(res.mode).toBe("r2");
    expect(res.uploadURL, "uploadURL must be present for R2 mode").toBeTruthy();

    const q = new URL(res.uploadURL!).searchParams;
    // The exact params that break R2 browser uploads must be absent.
    expect(q.has("x-amz-checksum-crc32"), "x-amz-checksum-crc32 must NOT be present").toBe(false);
    expect(q.has("x-amz-sdk-checksum-algorithm"), "x-amz-sdk-checksum-algorithm must NOT be present").toBe(false);
    // No checksum-family param at all.
    const checksumKeys = [...q.keys()].filter((k) => /checksum/i.test(k));
    expect(checksumKeys, `unexpected checksum params: ${checksumKeys.join(", ")}`).toHaveLength(0);
    // Still a valid SigV4 presign.
    expect(q.get("X-Amz-Signature")).toBeTruthy();
    expect(q.get("X-Amz-SignedHeaders")).toBe("host");
  });
});
