/**
 * tenant-isolation-mutations.test.ts — Remediation B2.7 / B2.7-FIX
 *
 * Cross-org document & file MUTATION isolation, plus positive in-org checks so
 * the fix does not over-block legitimate use, plus the mixed-id vector
 * (accessible project + a document from another project).
 *
 * Invariants:
 *   - Cross-org mutation → 403/404, never any 2xx, and NO state change.
 *   - Same operation in the correct org → succeeds (fix is not over-restrictive).
 *   - Valid own projectId + foreign documentId → denied.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable, orgConfigTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

interface Fx {
  orgA: { id: number }; orgB: { id: number };
  userA: { id: number }; userB: { id: number };
  projectA: { id: number }; projectB: { id: number };
  docMain: number; fileMain: number;   // for cross-org negatives (never mutated)
  docEdit: number;                      // for in-org positive edit + upload
  docDel: number;                       // for in-org positive delete
}
let fx: Fx;

function expectDenied(status: number, label: string) {
  expect([401, 403, 404], `${label} — expected 401/403/404 (denied), got ${status}`).toContain(status);
}

async function mkDoc(db: ReturnType<typeof getTestDb>, orgId: number, projectId: number, userId: number, num: string, title: string) {
  const [d] = await db.insert(documentsTable).values({
    organizationId: orgId, projectId, createdById: userId,
    documentNumber: num, title, revision: "A", status: "draft",
  }).returning();
  return d.id;
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const orgA = await createOrg({ name: "Mut Org Alpha", code: "MUTA" });
  const orgB = await createOrg({ name: "Mut Org Beta", code: "MUTB" });
  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@muta.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@mutb.test" });
  await db.insert(orgConfigTable).values({ organizationId: orgA.id, storageType: "onpremise", storagePath: "/tmp/edms-b27" });
  const projectA = await createProject({ organizationId: orgA.id, createdById: userA.id, name: "Alpha Mut", code: "MUTA-001" });
  const projectB = await createProject({ organizationId: orgB.id, createdById: userB.id, name: "Beta Mut", code: "MUTB-001" });

  const docMain = await mkDoc(db, orgA.id, projectA.id, userA.id, "MUT-MAIN", "Alpha Confidential");
  const [file] = await db.insert(documentFilesTable).values({
    documentId: docMain, organizationId: orgA.id,
    fileUrl: "/api/storage/onpremise/0/0/document/alpha.pdf", fileName: "alpha.pdf",
    fileSize: 1234, fileType: "application/pdf", uploadedById: userA.id, sha256: null,
  }).returning();
  const docEdit = await mkDoc(db, orgA.id, projectA.id, userA.id, "MUT-EDIT", "Alpha Editable");
  const docDel = await mkDoc(db, orgA.id, projectA.id, userA.id, "MUT-DEL", "Alpha Deletable");

  fx = { orgA, orgB, userA, userB, projectA, projectB, docMain, fileMain: file.id, docEdit, docDel };
});
afterAll(async () => { await truncateAllTables(); });

const P = (pid: number) => `/api/projects/${pid}/documents`;

describe("B2.7 — cross-org document/file mutation is DENIED (no state change)", () => {
  const asB = () => authHeader("admin", fx.userB.id, fx.orgB.id, "admin@mutb.test");
  const db = () => getTestDb();

  it("cross-org EDIT (PUT) denied; title unchanged", async () => {
    const res = await api().put(`${P(fx.projectA.id)}/${fx.docMain}`).set(asB()).send({ title: "HIJACK", status: "approved" });
    expectDenied(res.status, "PUT");
    const [row] = await db().select().from(documentsTable).where(eq(documentsTable.id, fx.docMain));
    expect(row.title).toBe("Alpha Confidential");
  });

  it("cross-org DELETE document denied; still exists (no 500)", async () => {
    const res = await api().delete(`${P(fx.projectA.id)}/${fx.docMain}`).set(asB());
    expectDenied(res.status, "DELETE doc");
    expect(res.status).not.toBe(500);
    const rows = await db().select().from(documentsTable).where(eq(documentsTable.id, fx.docMain));
    expect(rows.length).toBe(1);
  });

  it("cross-org FILE/REVISION upload denied; no file added", async () => {
    const res = await api().post(`${P(fx.projectA.id)}/${fx.docMain}/files`).set(asB())
      .attach("files", Buffer.from("evil"), { filename: "evil.pdf", contentType: "application/pdf" });
    expectDenied(res.status, "POST files");
    const files = await db().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, fx.docMain));
    expect(files.length).toBe(1);
  });

  it("cross-org FILE delete denied; file survives", async () => {
    const res = await api().delete(`${P(fx.projectA.id)}/${fx.docMain}/files/${fx.fileMain}`).set(asB());
    expectDenied(res.status, "DELETE file");
    const files = await db().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, fx.docMain));
    expect(files.length).toBe(1);
  });

  it("mixed-id: own project + foreign documentId denied (no cross-project leak)", async () => {
    // userB CAN access projectB, but docMain lives in projectA → must 404, not mutate.
    const res = await api().put(`${P(fx.projectB.id)}/${fx.docMain}`).set(asB()).send({ title: "X-PROJECT" });
    expectDenied(res.status, "PUT mixed-id");
    const [row] = await db().select().from(documentsTable).where(eq(documentsTable.id, fx.docMain));
    expect(row.title).toBe("Alpha Confidential");
  });
});

describe("B2.7 — same operations IN THE CORRECT org SUCCEED (fix not over-restrictive)", () => {
  const asA = () => authHeader("admin", fx.userA.id, fx.orgA.id, "admin@muta.test");
  const db = () => getTestDb();

  it("in-org EDIT (PUT) succeeds", async () => {
    const res = await api().put(`${P(fx.projectA.id)}/${fx.docEdit}`).set(asA()).send({ title: "Edited By Owner" });
    expect(res.status, `PUT own doc got ${res.status}`).toBe(200);
    const [row] = await db().select().from(documentsTable).where(eq(documentsTable.id, fx.docEdit));
    expect(row.title).toBe("Edited By Owner");
  });

  it("in-org FILE upload succeeds", async () => {
    const before = (await db().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, fx.docEdit))).length;
    const res = await api().post(`${P(fx.projectA.id)}/${fx.docEdit}/files`).set(asA())
      .attach("files", Buffer.from("legit revision"), { filename: "legit.pdf", contentType: "application/pdf" });
    expect(res.status, `upload own doc got ${res.status} ${JSON.stringify(res.body).slice(0,120)}`).toBe(201);
    const after = (await db().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, fx.docEdit))).length;
    expect(after).toBe(before + 1);
  });

  it("in-org DELETE document succeeds", async () => {
    const res = await api().delete(`${P(fx.projectA.id)}/${fx.docDel}`).set(asA());
    expect([200, 204], `delete own doc got ${res.status}`).toContain(res.status);
    const rows = await db().select().from(documentsTable).where(eq(documentsTable.id, fx.docDel));
    expect(rows.length).toBe(0);
  });
});
