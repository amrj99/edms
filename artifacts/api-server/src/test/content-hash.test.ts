/**
 * content-hash.test.ts — Sprint C-4: Content Hash
 *
 * Verifies that SHA-256 is computed from the actual file buffer at upload time
 * and stored in document_files.sha256.
 *
 * Uses the real upload endpoint (POST /api/projects/:projectId/documents/:id/files)
 * with system_owner role to bypass quota, trial, and email-verification gates.
 *
 * Scenarios:
 *   1. sha256 is computed correctly and stored in DB + returned in response
 *   2. Different file contents produce different hashes
 *   3. Legacy files (direct DB insert, no sha256) remain NULL — no backfill
 *   4. sha256 is exactly 64 lowercase hex characters (valid SHA-256 output)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import {
  getTestDb,
  truncateAllTables,
  createOrg,
  createUser,
  createProject,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable } from "@workspace/db";
import { api, makeToken } from "./helpers/index.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

let orgId: number;
let userId: number;
let projectId: number;
let documentId: number;

/** Token that bypasses quota / email / trial gates (system_owner role). */
function systemOwnerToken() {
  return makeToken({
    id: userId,
    email: "sysowner@test.edms",
    role: "system_owner",
    organizationId: orgId,
  });
}

/** Upload a buffer to the test document and return the response. */
async function uploadFile(content: Buffer, filename = "test.txt") {
  return api()
    .post(`/api/projects/${projectId}/documents/${documentId}/files`)
    .set("Authorization", `Bearer ${systemOwnerToken()}`)
    .attach("files", content, { filename, contentType: "text/plain" });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("document_files.sha256 — Content Hash (C-4)", () => {
  beforeAll(async () => {
    await truncateAllTables();

    const org = await createOrg({ name: "Hash Test Org", code: "HASH01" });
    orgId = org.id;

    const user = await createUser({ organizationId: orgId, role: "admin" });
    userId = user.id;

    const project = await createProject({ organizationId: orgId });
    projectId = project.id;

    // Create a bare document (no file) to serve as the upload target
    const db = getTestDb();
    const [doc] = await db
      .insert(documentsTable)
      .values({
        documentNumber: "HASH-001",
        title: "Hash Test Document",
        projectId,
        organizationId: orgId,
        createdById: userId,
        revision: "A",
        status: "draft",
      })
      .returning();
    documentId = doc.id;
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────

  it("sha256 is computed, stored in DB, and returned in response", async () => {
    const content = Buffer.from("Sprint C-4 content hash test payload");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const res = await uploadFile(content, "document.txt");

    expect(res.status).toBe(201);
    expect(res.body.files).toHaveLength(1);

    const fileInResponse = res.body.files[0];
    expect(fileInResponse.sha256).toBe(expectedHash);

    // Verify the value is actually persisted in the DB
    const db = getTestDb();
    const [dbRow] = await db
      .select({ sha256: documentFilesTable.sha256 })
      .from(documentFilesTable)
      .where(eq(documentFilesTable.id, fileInResponse.id));

    expect(dbRow?.sha256).toBe(expectedHash);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────

  it("different file contents produce different hashes", async () => {
    const contentA = Buffer.from("File A — unique content 111");
    const contentB = Buffer.from("File B — unique content 222");
    const hashA = crypto.createHash("sha256").update(contentA).digest("hex");
    const hashB = crypto.createHash("sha256").update(contentB).digest("hex");

    const [resA, resB] = await Promise.all([
      uploadFile(contentA, "a.txt"),
      uploadFile(contentB, "b.txt"),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.files[0].sha256).toBe(hashA);
    expect(resB.body.files[0].sha256).toBe(hashB);
    expect(hashA).not.toBe(hashB);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────

  it("legacy files inserted without sha256 remain NULL — no backfill", async () => {
    const db = getTestDb();

    const [legacyFile] = await db
      .insert(documentFilesTable)
      .values({
        documentId,
        organizationId: orgId,
        fileUrl: "/api/storage/onpremise/0/0/document/legacy.pdf",
        fileName: "legacy.pdf",
        fileSize: 98765,
        fileType: "application/pdf",
        uploadedById: userId,
        sha256: null,
      })
      .returning();

    expect(legacyFile.sha256).toBeNull();

    // Confirm it's NULL in the DB — not auto-populated
    const [dbRow] = await db
      .select({ sha256: documentFilesTable.sha256 })
      .from(documentFilesTable)
      .where(eq(documentFilesTable.id, legacyFile.id));

    expect(dbRow?.sha256).toBeNull();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────

  it("sha256 is a valid 64-character lowercase hex string", async () => {
    const content = Buffer.from("Deterministic payload for format validation");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const res = await uploadFile(content, "format-check.txt");

    expect(res.status).toBe(201);
    const sha256 = res.body.files[0].sha256 as string;

    // SHA-256 = 256 bits = 64 hex nibbles, always lowercase from Node's digest("hex")
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256).toBe(expectedHash);
  });
});
