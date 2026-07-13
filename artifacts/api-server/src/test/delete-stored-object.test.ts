/**
 * delete-stored-object.test.ts — Remediation B2.3a (compensation adapters)
 *
 * Unit/adapter tests for orgStorage.deleteStoredObject across all four storage
 * backends. Each asserts:
 *   - correct path / bucket isolation (the object addressed is exactly the one
 *     written — right bucket, right key, right org), and
 *   - idempotency (an already-absent object is a no-op, never an error), so the
 *     compensation step is safe to run/retry.
 *
 * The AWS SDK and the GCS client are mocked so no network/real backend is hit;
 * on-premise uses the real filesystem in an isolated temp dir.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createOrg, getTestDb } from "./helpers/index.js";
import { orgConfigTable } from "@workspace/db";

const h = vi.hoisted(() => ({
  s3Send: vi.fn(),
  gcsDelete: vi.fn(),
}));

// AWS SDK (used by both the per-org S3 client and the global R2 client).
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = h.s3Send; },
  DeleteObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
  PutObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
  GetObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
}));

// GCS object-storage client (cloud mode). Partial mock — keep the real module
// (orgStorage constructs ObjectStorageService at load) and only override the
// client so we can capture bucket + object + options.
vi.mock("../lib/objectStorage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage.js")>();
  return {
    ...actual,
    objectStorageClient: {
      bucket: (name: string) => ({ file: (obj: string) => ({ delete: (opts: any) => h.gcsDelete(name, obj, opts) }) }),
    },
  };
});

import { deleteStoredObject } from "../lib/orgStorage.js";

beforeEach(() => { h.s3Send.mockReset(); h.gcsDelete.mockReset(); });

describe("B2.3a adapter — on-premise", () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "b23a-onprem-")); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("deletes exactly the target file and leaves siblings untouched (isolation)", async () => {
    const a = path.join(dir, "a.pdf");
    const b = path.join(dir, "b.pdf");
    fs.writeFileSync(a, "A");
    fs.writeFileSync(b, "B");

    await deleteStoredObject({ mode: "onpremise", objectPath: a, organizationId: 1 });

    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(true); // sibling not affected
  });

  it("is idempotent — deleting an already-absent file does not throw", async () => {
    const gone = path.join(dir, "never.pdf");
    await expect(deleteStoredObject({ mode: "onpremise", objectPath: gone, organizationId: 1 })).resolves.toBeUndefined();
  });
});

describe("B2.3a adapter — per-org S3", () => {
  let orgId: number;
  beforeAll(async () => {
    const org = await createOrg({ name: "S3 Adapter Org", code: "S3AD" });
    orgId = org.id;
    await getTestDb().insert(orgConfigTable).values({
      organizationId: orgId, storageType: "s3", s3Bucket: "bucket-alpha", s3Region: "us-east-1",
    });
  });

  it("addresses the org's configured bucket + exact key (bucket/key isolation)", async () => {
    h.s3Send.mockResolvedValueOnce({});
    await deleteStoredObject({ mode: "s3", objectPath: "1/2/document/k.pdf", organizationId: orgId });

    expect(h.s3Send).toHaveBeenCalledTimes(1);
    const cmd = h.s3Send.mock.calls[0][0];
    expect(cmd.input).toEqual({ Bucket: "bucket-alpha", Key: "1/2/document/k.pdf" });
  });

  it("is idempotent — a missing key (S3 returns 204) does not throw", async () => {
    h.s3Send.mockResolvedValueOnce({}); // S3 DeleteObject is 204 whether or not the key existed
    await expect(deleteStoredObject({ mode: "s3", objectPath: "1/2/document/missing.pdf", organizationId: orgId }))
      .resolves.toBeUndefined();
  });

  it("throws (surfaces potential orphan) when the org has no S3 bucket configured", async () => {
    const org = await createOrg({ name: "No S3 Org", code: "NOS3" });
    await expect(deleteStoredObject({ mode: "s3", objectPath: "x/y.pdf", organizationId: org.id }))
      .rejects.toThrow(/no S3 config/i);
    expect(h.s3Send).not.toHaveBeenCalled();
  });
});

describe("B2.3a adapter — global R2", () => {
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY", "R2_SECRET_KEY"]) saved[k] = process.env[k];
    process.env.R2_BUCKET = "r2-bucket-x";
    process.env.R2_ENDPOINT = "https://r2.example.com";
    process.env.R2_ACCESS_KEY = "ak";
    process.env.R2_SECRET_KEY = "sk";
  });
  afterAll(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

  it("addresses the R2 bucket + exact key (bucket/key isolation)", async () => {
    h.s3Send.mockResolvedValueOnce({});
    await deleteStoredObject({ mode: "r2", objectPath: "org_1/projects/2/k.pdf", organizationId: 1 });

    expect(h.s3Send).toHaveBeenCalledTimes(1);
    const cmd = h.s3Send.mock.calls[0][0];
    expect(cmd.input).toEqual({ Bucket: "r2-bucket-x", Key: "org_1/projects/2/k.pdf" });
  });

  it("is idempotent — a missing key does not throw", async () => {
    h.s3Send.mockResolvedValueOnce({});
    await expect(deleteStoredObject({ mode: "r2", objectPath: "org_1/projects/2/gone.pdf", organizationId: 1 }))
      .resolves.toBeUndefined();
  });
});

describe("B2.3a adapter — cloud (GCS)", () => {
  const saved = process.env.PRIVATE_OBJECT_DIR;
  beforeAll(() => { process.env.PRIVATE_OBJECT_DIR = "mybucket/private"; });
  afterAll(() => { if (saved === undefined) delete process.env.PRIVATE_OBJECT_DIR; else process.env.PRIVATE_OBJECT_DIR = saved; });

  it("reconstructs bucket + object from PRIVATE_OBJECT_DIR (path isolation) and requests idempotent delete", async () => {
    h.gcsDelete.mockResolvedValueOnce(undefined);
    await deleteStoredObject({ mode: "cloud", objectPath: "/objects/123_f.pdf", organizationId: null });

    expect(h.gcsDelete).toHaveBeenCalledTimes(1);
    const [bucket, object, opts] = h.gcsDelete.mock.calls[0];
    expect(bucket).toBe("mybucket");
    expect(object).toBe("private/uploads/123_f.pdf");
    expect(opts).toEqual({ ignoreNotFound: true }); // idempotency at the SDK level
  });

  it("throws (surfaces potential orphan) when PRIVATE_OBJECT_DIR is unset", async () => {
    delete process.env.PRIVATE_OBJECT_DIR;
    await expect(deleteStoredObject({ mode: "cloud", objectPath: "/objects/z.pdf", organizationId: null }))
      .rejects.toThrow(/PRIVATE_OBJECT_DIR/);
    process.env.PRIVATE_OBJECT_DIR = "mybucket/private";
  });
});
