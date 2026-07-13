/**
 * document-upload-atomicity.test.ts — Remediation B2.3a
 *
 * Failure-injection tests for the Document File Upload write path.
 *
 * Design under test (approved Alternative 2 — Compensation + DB Transaction):
 *   Phase 1: write every file to storage, collecting exact descriptors.
 *   Phase 2: ONE db.transaction — all document_files rows + success audit rows
 *            + quota increment. Any failure rolls the whole transaction back,
 *            then compensation deletes the Phase-1 storage objects.
 *
 * We inject failures at each seam and assert the closure invariants:
 *   - zero half-written document_files rows,
 *   - zero success-audit rows for a failed operation,
 *   - quota does not drift,
 *   - compensation removes every storage object written in the failed request,
 *   - a failed compensation surfaces the residual storage key (not hidden).
 *
 * Seams are spied with call-through defaults so this stays a real integration
 * test (real DB, real on-premise storage on disk); only the injected seam
 * deviates per test. The "storage object deleted" assertion is a real
 * filesystem check — proof that compensation actually ran end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs";
import { sql, eq } from "drizzle-orm";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable, organizationsTable, orgConfigTable } from "@workspace/db";

import * as storageMod from "../lib/orgStorage.js";
import * as fileWriteMod from "../lib/document-file-write.js";
import * as auditMod from "../lib/audit.js";
import { storageQuota } from "../lib/storage-quota.js";

// Capture real implementations BEFORE any spy so call-through wrappers can
// invoke them (needed for "succeed on file 1, fail on file 2" injections).
const realUploadBuffer = storageMod.uploadBuffer;
const realInsertRow = fileWriteMod.insertDocumentFileRow;

interface Fx {
  org: { id: number };
  user: { id: number };
  project: { id: number };
  docId: number;
}
let fx: Fx;

const P = (pid: number) => `/api/projects/${pid}/documents`;

async function mkDoc(db: ReturnType<typeof getTestDb>, orgId: number, projectId: number, userId: number, num: string) {
  const [d] = await db.insert(documentsTable).values({
    organizationId: orgId, projectId, createdById: userId,
    documentNumber: num, title: "Atomicity Target", revision: "A", status: "draft",
  }).returning();
  return d.id;
}

async function fileCount(docId: number): Promise<number> {
  return (await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, docId))).length;
}
async function auditCount(docId: number): Promise<number> {
  const r: any = await getTestDb().execute(
    sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity_id = ${docId} AND action = 'update' AND entity_type = 'document'`,
  );
  return Number(r.rows[0].c);
}
async function usedMb(orgId: number): Promise<number> {
  const [o] = await getTestDb().select({ v: organizationsTable.storageUsedMb }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return o?.v ?? 0;
}
/** Absolute on-disk path of the last object uploadBuffer produced (on-premise). */
async function lastStoredPath(): Promise<string> {
  const results = (storageMod.uploadBuffer as any).mock?.results ?? [];
  const last = results[results.length - 1];
  const stored = await last.value;
  return stored.objectPath as string;
}

const auth = () => authHeader("admin", fx.user.id, fx.org.id, "admin@atomicity.test");
const attach = (r: ReturnType<typeof api>["post"] extends (...a: any) => infer R ? R : any, name: string, body: string) =>
  r.attach("files", Buffer.from(body), { filename: name, contentType: "application/pdf" });

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const org = await createOrg({ name: "Atomicity Org", code: "ATOM" });
  const user = await createUser({ organizationId: org.id, role: "admin", email: "admin@atomicity.test" });
  await db.insert(orgConfigTable).values({ organizationId: org.id, storageType: "onpremise", storagePath: "/tmp/edms-b23a" });
  const project = await createProject({ organizationId: org.id, createdById: user.id, name: "Atom Proj", code: "ATOM-001" });
  const docId = await mkDoc(db, org.id, project.id, user.id, "ATOM-DOC");
  fx = { org, user, project, docId };
});
afterAll(async () => { await truncateAllTables(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Snapshot the three invariants, run body, assert none changed on failure. */
async function expectNoStateChange(body: () => Promise<void>) {
  const before = { files: await fileCount(fx.docId), audit: await auditCount(fx.docId), mb: await usedMb(fx.org.id) };
  await body();
  expect(await fileCount(fx.docId), "document_files rows must be unchanged").toBe(before.files);
  expect(await auditCount(fx.docId), "success-audit rows must be unchanged").toBe(before.audit);
  expect(await usedMb(fx.org.id), "quota must not drift").toBe(before.mb);
}

describe("B2.3a — Document File Upload Atomicity (failure injection)", () => {
  it("1) storage fails before the first file → no DB writes, nothing to compensate", async () => {
    const del = vi.spyOn(storageMod, "deleteStoredObject");
    vi.spyOn(storageMod, "uploadBuffer").mockRejectedValueOnce(new Error("storage down"));
    await expectNoStateChange(async () => {
      const res = await attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "a.pdf", "AAA");
      expect(res.status).toBe(500);
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("2) file 1 stored, file 2 storage-fails → file 1 deleted, no DB writes", async () => {
    let n = 0;
    const up = vi.spyOn(storageMod, "uploadBuffer").mockImplementation(async (p: any) => {
      n++;
      if (n === 2) throw new Error("storage down on file 2");
      return realUploadBuffer(p);
    });
    const del = vi.spyOn(storageMod, "deleteStoredObject");
    await expectNoStateChange(async () => {
      const res = await attach(
        attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "one.pdf", "ONE"),
        "two.pdf", "TWO",
      );
      expect(res.status).toBe(500);
    });
    // Exactly the first stored object was compensated.
    expect(del).toHaveBeenCalledTimes(1);
    const firstStored = await up.mock.results[0].value;
    expect(fs.existsSync(firstStored.objectPath)).toBe(false);
  });

  it("3) storage ok, first DB insert fails → all storage objects deleted, no rows", async () => {
    vi.spyOn(storageMod, "uploadBuffer"); // capture results (call-through)
    vi.spyOn(fileWriteMod, "insertDocumentFileRow").mockRejectedValueOnce(new Error("insert boom"));
    await expectNoStateChange(async () => {
      const res = await attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "b.pdf", "BBB");
      expect(res.status).toBe(500);
    });
    expect(fs.existsSync(await lastStoredPath())).toBe(false);
  });

  it("4) failure after some file rows inserted → FULL rollback + all storage deleted", async () => {
    const up = vi.spyOn(storageMod, "uploadBuffer");
    let n = 0;
    vi.spyOn(fileWriteMod, "insertDocumentFileRow").mockImplementation(async (tx: any, values: any) => {
      n++;
      if (n === 2) throw new Error("insert boom on row 2");
      return realInsertRow(tx, values);
    });
    await expectNoStateChange(async () => {
      const res = await attach(
        attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "r1.pdf", "R1"),
        "r2.pdf", "R2",
      );
      expect(res.status).toBe(500);
    });
    // Both storage objects (even the one whose row inserted then rolled back) are gone.
    for (const r of up.mock.results) {
      const stored = await r.value;
      expect(fs.existsSync(stored.objectPath)).toBe(false);
    }
  });

  it("5) audit fails inside the transaction → FULL rollback + storage deleted", async () => {
    vi.spyOn(storageMod, "uploadBuffer");
    vi.spyOn(auditMod, "createAuditLogTx").mockRejectedValueOnce(new Error("audit boom"));
    await expectNoStateChange(async () => {
      const res = await attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "c.pdf", "CCC");
      expect(res.status).toBe(500);
    });
    expect(fs.existsSync(await lastStoredPath())).toBe(false);
  });

  it("6) quota update fails → FULL rollback + storage deleted", async () => {
    vi.spyOn(storageMod, "uploadBuffer");
    vi.spyOn(storageQuota, "increment").mockRejectedValueOnce(new Error("quota boom"));
    await expectNoStateChange(async () => {
      const res = await attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "d.pdf", "DDD");
      expect(res.status).toBe(500);
    });
    expect(fs.existsSync(await lastStoredPath())).toBe(false);
  });

  it("7) compensation delete itself fails → op fails AND residual storage key surfaced", async () => {
    const up = vi.spyOn(storageMod, "uploadBuffer");
    vi.spyOn(storageQuota, "increment").mockRejectedValueOnce(new Error("quota boom → force rollback"));
    vi.spyOn(storageMod, "deleteStoredObject").mockRejectedValueOnce(new Error("storage delete failed"));
    let residualPath = "";
    await expectNoStateChange(async () => {
      const res = await attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "e.pdf", "EEE");
      expect(res.status).toBe(500);
      // Clear evidence: the un-deletable object's storage key is returned.
      expect(Array.isArray(res.body.orphanedStorageKeys)).toBe(true);
      expect(res.body.orphanedStorageKeys.length).toBeGreaterThan(0);
      residualPath = (await up.mock.results[0].value).objectPath;
      expect(res.body.orphanedStorageKeys).toContain(residualPath);
    });
    // Compensation failed → the object really is still on disk. Clean up so the
    // temp dir does not accumulate this deliberate orphan.
    expect(fs.existsSync(residualPath)).toBe(true);
    try { fs.unlinkSync(residualPath); } catch { /* ignore */ }
  });

  it("8) multi-file success → all rows + audits + quota committed together", async () => {
    const up = vi.spyOn(storageMod, "uploadBuffer");
    const beforeFiles = await fileCount(fx.docId);
    const beforeAudit = await auditCount(fx.docId);
    const beforeMb = await usedMb(fx.org.id);

    const res = await attach(
      attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "s1.pdf", "SUCCESS-ONE"),
      "s2.pdf", "SUCCESS-TWO",
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(201);
    expect(res.body.files.length).toBe(2);

    expect(await fileCount(fx.docId)).toBe(beforeFiles + 2);
    expect(await auditCount(fx.docId)).toBe(beforeAudit + 2);
    expect(await usedMb(fx.org.id)).toBe(beforeMb + 1); // ceil(tiny total / 1MB) = 1
    // Both objects are present on disk (committed, not compensated).
    for (const r of up.mock.results) {
      const stored = await r.value;
      expect(fs.existsSync(stored.objectPath)).toBe(true);
    }
  });

  // ── Engineering Observation (documented gap, NOT a fix) ────────────────────
  // The upload endpoint has no Request/Idempotency key. A retried identical
  // request therefore creates a SECOND set of rows + storage objects. This test
  // pins the CURRENT behaviour; de-duplication is out of scope for B2.3a and is
  // recorded as a follow-up (needs owner approval before implementing).
  it("9) [known gap] no idempotency key → identical retry creates duplicate rows", async () => {
    const before = await fileCount(fx.docId);
    const send = () => attach(api().post(`${P(fx.project.id)}/${fx.docId}/files`).set(auth()), "dup.pdf", "DUP");
    const r1 = await send();
    const r2 = await send();
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await fileCount(fx.docId)).toBe(before + 2); // duplicates, not deduped
  });
});
