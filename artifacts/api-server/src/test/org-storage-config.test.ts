/**
 * org-storage-config.test.ts
 *
 * Regression suite for the org-storage default-config bug:
 *
 *   - org_config.storage_type defaults to "s3" with no bucket. When a new
 *     org is created via register-org without an explicit storageType,
 *     requestUpload() used to ignore DEFAULT_STORAGE_TYPE (because the DB
 *     value "s3" is non-null) and fall through to a dead Replit/
 *     PRIVATE_OBJECT_DIR code path, crashing with a 500.
 *
 * This suite verifies:
 *   1. register-org sets org_config.storageType from DEFAULT_STORAGE_TYPE
 *      (defaulting to "onpremise"), not relying on the DB schema default.
 *   2. requestUpload() treats storageType="s3" without s3Bucket as unusable
 *      and falls back to DEFAULT_STORAGE_TYPE.
 *   3. requestUpload() still honours a real per-org S3 config.
 *   4. requestUpload() throws StorageNotConfiguredError (not a generic 500)
 *      when no storage provider can be resolved at all.
 *   5. POST /api/storage/uploads/request-url returns 503 storage_not_configured
 *      instead of a generic 500 in that case.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { api, authHeader, createOrg, createUser, getTestDb, truncateAllTables } from "./helpers/index.js";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requestUpload } from "../lib/orgStorage.js";
import { StorageNotConfiguredError } from "../lib/errors.js";
import os from "os";
import path from "path";

const db = getTestDb();

const ORIGINAL_ENV = {
  DEFAULT_STORAGE_TYPE: process.env.DEFAULT_STORAGE_TYPE,
  DEFAULT_STORAGE_PATH: process.env.DEFAULT_STORAGE_PATH,
  PRIVATE_OBJECT_DIR: process.env.PRIVATE_OBJECT_DIR,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

describe("register-org sets an explicit storageType", () => {
  it("uses DEFAULT_STORAGE_TYPE when set", async () => {
    process.env.DEFAULT_STORAGE_TYPE = "onpremise";

    const res = await api().post("/api/auth/register-org").send({
      orgName: "Storage Default Org A",
      adminFirstName: "Storage",
      adminLastName: "Admin",
      adminEmail: "storage-admin-a@test.edms",
      adminPassword: "TestPass123!",
    });

    expect(res.status).toBe(201);

    const [cfg] = await db
      .select()
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, res.body.orgId));

    expect(cfg?.storageType).toBe("onpremise");
  });

  it("defaults to onpremise when DEFAULT_STORAGE_TYPE is unset (not the schema's 's3' default)", async () => {
    delete process.env.DEFAULT_STORAGE_TYPE;

    const res = await api().post("/api/auth/register-org").send({
      orgName: "Storage Default Org B",
      adminFirstName: "Storage",
      adminLastName: "Admin",
      adminEmail: "storage-admin-b@test.edms",
      adminPassword: "TestPass123!",
    });

    expect(res.status).toBe(201);

    const [cfg] = await db
      .select()
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, res.body.orgId));

    expect(cfg?.storageType).toBe("onpremise");
    expect(cfg?.storageType).not.toBe("s3");
  });
});

describe("requestUpload() storage resolution", () => {
  it("falls back to DEFAULT_STORAGE_TYPE when storageType='s3' has no bucket", async () => {
    const org = await createOrg({ name: "RU Org 1", code: "RUORG1" });
    const onPremPath = path.join(os.tmpdir(), `edms-test-storage-${org.id}`);

    await db.insert(orgConfigTable).values({
      organizationId: org.id,
      storageType: "s3",
      s3Bucket: null,
    });

    process.env.DEFAULT_STORAGE_TYPE = "onpremise";
    process.env.DEFAULT_STORAGE_PATH = onPremPath;
    delete process.env.PRIVATE_OBJECT_DIR;

    const result = await requestUpload({
      organizationId: org.id,
      name: "test-file.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(result.mode).toBe("onpremise");
  });

  it("honours a real per-org S3 config (storageType='s3' with s3Bucket)", async () => {
    const org = await createOrg({ name: "RU Org 2", code: "RUORG2" });

    await db.insert(orgConfigTable).values({
      organizationId: org.id,
      storageType: "s3",
      s3Bucket: "real-bucket",
      s3Region: "us-east-1",
      s3AccessKey: "AKIATESTACCESSKEY",
      s3SecretKey: "test-secret-access-key",
    });

    const result = await requestUpload({
      organizationId: org.id,
      name: "test-file.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(result.mode).toBe("s3");
    expect(result.uploadURL).toBeTruthy();
  });

  it("throws StorageNotConfiguredError when no provider can be resolved", async () => {
    const org = await createOrg({ name: "RU Org 3", code: "RUORG3" });

    await db.insert(orgConfigTable).values({
      organizationId: org.id,
      storageType: "cloud",
      s3Bucket: null,
    });

    delete process.env.DEFAULT_STORAGE_TYPE;
    delete process.env.PRIVATE_OBJECT_DIR;

    await expect(
      requestUpload({
        organizationId: org.id,
        name: "test-file.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });
});

describe("POST /api/storage/uploads/request-url — no provider configured", () => {
  it("returns 503 storage_not_configured instead of a generic 500", async () => {
    const org = await createOrg({ name: "RU Org 4", code: "RUORG4" });
    const admin = await createUser({ organizationId: org.id, role: "admin", email: "ru-org-4-admin@test.edms" });

    await db.insert(orgConfigTable).values({
      organizationId: org.id,
      storageType: "cloud",
      s3Bucket: null,
    });

    delete process.env.DEFAULT_STORAGE_TYPE;
    delete process.env.PRIVATE_OBJECT_DIR;

    const res = await api()
      .post("/api/storage/uploads/request-url")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "test-file.docx", contentType: "application/octet-stream" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("storage_not_configured");
  });
});
