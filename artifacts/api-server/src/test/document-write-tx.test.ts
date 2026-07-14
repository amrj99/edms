/**
 * document-write-tx.test.ts — Remediation B2.3d
 *
 * The document CREATE (POST /) and EDIT (PUT /:id) write paths now wrap their
 * core rows in ONE db.transaction: a document + its initial/new revision + the
 * primary file row + the audits are all-or-nothing. Previously they were
 * written as separate statements, so a mid-write failure could leave a
 * revision-less document (or a status change with no status_change audit).
 *
 * We inject a failure at the audit seam (createAuditLogTx) — which runs inside
 * both transactions — and assert the whole write rolls back. Best-effort
 * enrichment (AI, rules, notifications, email) stays outside the transaction.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { db, documentsTable, documentRevisionsTable, documentFilesTable } from "@workspace/db";
import * as auditMod from "../lib/audit.js";

/**
 * Per-write-point failure seam (no production hooks).
 *
 * Forces a specific table's insert/update to throw at exactly one write point,
 * on BOTH code shapes:
 *   • transactional code  → mocks db.transaction to run the REAL transaction but
 *     hand the handler a Proxy `tx` that throws when it reaches the target write.
 *   • non-transactional code (legacy separate statements) → also throws at the
 *     matching db.<op>(table) call.
 * Because the same seam fires on both shapes, one assertion set ("nothing / left
 * unchanged") is GREEN on the current tx code and RED on the legacy code (which
 * leaves a partial write). afterEach → vi.restoreAllMocks() tears it down.
 */
function failAt(table: unknown, op: "insert" | "update", msg = "write boom"): void {
  const realTransaction = (db as any).transaction.bind(db);
  vi.spyOn(db as any, "transaction").mockImplementation((cb: any, ...rest: any[]) =>
    realTransaction(async (tx: any) => {
      const proxy = new Proxy(tx, {
        get(t: any, prop: string) {
          if (prop === op) {
            return (arg: unknown) => {
              if (arg === table) throw new Error(msg);
              return t[op](arg);
            };
          }
          const v = t[prop];
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      return cb(proxy);
    }, ...rest));

  const realOp = (db as any)[op].bind(db);
  vi.spyOn(db as any, op).mockImplementation((arg: unknown) => {
    if (arg === table) throw new Error(msg);
    return realOp(arg);
  });
}

interface Fx { org: { id: number }; admin: { id: number }; project: { id: number }; }
let fx: Fx;

const P = () => `/api/projects/${fx.project.id}/documents`;
const asAdmin = () => authHeader("admin", fx.admin.id, fx.org.id, "admin@dwtx.test");

async function docByNumber(num: string) {
  const [d] = await getTestDb().select().from(documentsTable)
    .where(and(eq(documentsTable.projectId, fx.project.id), eq(documentsTable.documentNumber, num)));
  return d;
}
async function revCount(docId: number): Promise<number> {
  return (await getTestDb().select().from(documentRevisionsTable).where(eq(documentRevisionsTable.documentId, docId))).length;
}
async function fileCount(docId: number): Promise<number> {
  return (await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, docId))).length;
}
async function auditCount(docId: number, action: string): Promise<number> {
  const r: any = await getTestDb().execute(
    sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity_id = ${docId} AND action = ${action} AND entity_type = 'document'`,
  );
  return Number(r.rows[0].c);
}

beforeAll(async () => {
  await truncateAllTables();
  const org = await createOrg({ name: "DocTx Org", code: "DWTX" });
  const admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@dwtx.test" });
  const project = await createProject({ organizationId: org.id, createdById: admin.id, name: "DocTx Proj", code: "DWTX-001" });
  fx = { org, admin, project };
});
afterAll(async () => { await truncateAllTables(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("B2.3d — Document create/edit write-path transaction integrity", () => {
  it("create success → document + initial revision + primary file + create audit all committed", async () => {
    const res = await api().post(P()).set(asAdmin()).send({
      documentNumber: "DWTX-CREATE-OK", title: "Created", fileUrl: "/api/storage/onpremise/1/1/document/x.pdf", fileName: "x.pdf", fileSize: 10,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(201);
    const doc = await docByNumber("DWTX-CREATE-OK");
    expect(doc).toBeTruthy();
    expect(await revCount(doc.id)).toBe(1);          // initial revision
    expect(await fileCount(doc.id)).toBe(1);         // primary file row
    expect(await auditCount(doc.id, "create")).toBe(1);
    expect(doc.organizationId).toBe(fx.org.id);      // owner-org attribution
  });

  it("create tx failure (audit throws) → NOTHING is written (no document, revision, or file)", async () => {
    vi.spyOn(auditMod, "createAuditLogTx").mockRejectedValueOnce(new Error("audit boom"));
    const res = await api().post(P()).set(asAdmin()).send({
      documentNumber: "DWTX-CREATE-FAIL", title: "ShouldRollback", fileUrl: "/api/storage/onpremise/1/1/document/y.pdf", fileName: "y.pdf", fileSize: 10,
    });
    expect(res.status).toBe(500);
    // The whole transaction rolled back: the document must not exist at all,
    // so there can be no orphan revision or file either.
    expect(await docByNumber("DWTX-CREATE-FAIL")).toBeUndefined();
  });

  it("edit success with a revision bump → document updated + new revision row + update audit", async () => {
    // Seed a document to edit.
    const c = await api().post(P()).set(asAdmin()).send({ documentNumber: "DWTX-EDIT", title: "Before", revision: "A" });
    expect(c.status).toBe(201);
    const doc = await docByNumber("DWTX-EDIT");
    const revBefore = await revCount(doc.id);

    const res = await api().put(`${P()}/${doc.id}`).set(asAdmin()).send({ title: "After", revision: "B", revisionNotes: "bumped" });
    expect(res.status).toBe(200);
    const after = await docByNumber("DWTX-EDIT");
    expect(after.title).toBe("After");
    expect(after.revision).toBe("B");
    expect(await revCount(doc.id)).toBe(revBefore + 1);       // new revision row
    expect(await auditCount(doc.id, "update")).toBeGreaterThanOrEqual(1);
  });

  it("edit tx failure (audit throws) → document left fully unchanged", async () => {
    const c = await api().post(P()).set(asAdmin()).send({ documentNumber: "DWTX-EDIT-FAIL", title: "Original", revision: "A" });
    expect(c.status).toBe(201);
    const doc = await docByNumber("DWTX-EDIT-FAIL");
    const revBefore = await revCount(doc.id);

    vi.spyOn(auditMod, "createAuditLogTx").mockRejectedValueOnce(new Error("audit boom"));
    const res = await api().put(`${P()}/${doc.id}`).set(asAdmin()).send({ title: "Hijacked", revision: "B" });
    expect(res.status).toBe(500);

    const after = await docByNumber("DWTX-EDIT-FAIL");
    expect(after.title).toBe("Original");          // update rolled back
    expect(after.revision).toBe("A");
    expect(await revCount(doc.id)).toBe(revBefore); // no new revision row
  });

  // ── Per-write-point rollback coverage (failAt seam) ───────────────────────
  // Each test forces ONE write inside the transaction to throw and asserts the
  // WHOLE write rolled back. GREEN here on the tx code; the same tests are RED
  // on the legacy separate-statement code (partial write persists).

  it("CREATE: documents.insert failure → 500, nothing written", async () => {
    failAt(documentsTable, "insert");
    const res = await api().post(P()).set(asAdmin()).send({
      documentNumber: "DWTX-C-DOC", title: "x", fileUrl: "/api/storage/onpremise/1/1/document/a.pdf", fileName: "a.pdf", fileSize: 10,
    });
    expect(res.status).toBe(500);
    expect(await docByNumber("DWTX-C-DOC")).toBeUndefined();
    // documents.insert is the FIRST write → no earlier row can leak; this test
    // confirms the write point aborts the request cleanly (partial impossible
    // by construction, so it is GREEN on legacy too — noted in the report).
  });

  it("CREATE: documentRevisions.insert failure → 500, no document, no revision", async () => {
    failAt(documentRevisionsTable, "insert");
    const res = await api().post(P()).set(asAdmin()).send({
      documentNumber: "DWTX-C-REV", title: "x", fileUrl: "/api/storage/onpremise/1/1/document/b.pdf", fileName: "b.pdf", fileSize: 10,
    });
    expect(res.status).toBe(500);
    // Rollback proof: the document row (written BEFORE the failing revision)
    // must not survive — this is RED on legacy (doc persists revision-less).
    expect(await docByNumber("DWTX-C-REV")).toBeUndefined();
  });

  it("CREATE: documentFiles.insert failure → 500, no document, no revision, no file", async () => {
    failAt(documentFilesTable, "insert");
    const res = await api().post(P()).set(asAdmin()).send({
      documentNumber: "DWTX-C-FILE", title: "x", fileUrl: "/api/storage/onpremise/1/1/document/c.pdf", fileName: "c.pdf", fileSize: 10,
    });
    expect(res.status).toBe(500);
    // Strongest RED vs legacy: there the primary-file insert was swallowed in a
    // try/catch, so legacy returned 201 with a revision-less-safe doc+revision
    // committed. The tx code rolls the whole thing back.
    expect(await docByNumber("DWTX-C-FILE")).toBeUndefined();
  });

  it("EDIT: documents.update failure → 500, document left unchanged", async () => {
    const c = await api().post(P()).set(asAdmin()).send({ documentNumber: "DWTX-E-UPD", title: "Original", revision: "A" });
    expect(c.status).toBe(201);
    const doc = await docByNumber("DWTX-E-UPD");

    failAt(documentsTable, "update");
    const res = await api().put(`${P()}/${doc.id}`).set(asAdmin()).send({ title: "Hijacked", revision: "B" });
    expect(res.status).toBe(500);
    const after = await docByNumber("DWTX-E-UPD");
    expect(after.title).toBe("Original"); // update is the FIRST edit write → clean abort (GREEN on legacy too)
    expect(after.revision).toBe("A");
  });

  it("EDIT: documentRevisions.insert failure (new revision) → 500, document fully unchanged", async () => {
    const c = await api().post(P()).set(asAdmin()).send({ documentNumber: "DWTX-E-REV", title: "Original", revision: "A" });
    expect(c.status).toBe(201);
    const doc = await docByNumber("DWTX-E-REV");
    const revBefore = await revCount(doc.id);

    failAt(documentRevisionsTable, "insert");
    const res = await api().put(`${P()}/${doc.id}`).set(asAdmin()).send({ title: "After", revision: "B", revisionNotes: "bump" });
    expect(res.status).toBe(500);
    // Rollback proof: the document update (written BEFORE the failing revision
    // insert) must be undone — RED on legacy (title/revision changed, no rev row).
    const after = await docByNumber("DWTX-E-REV");
    expect(after.title).toBe("Original");
    expect(after.revision).toBe("A");
    expect(await revCount(doc.id)).toBe(revBefore);
  });
});
