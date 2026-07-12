/**
 * tenant-isolation-mutations.test.ts — Remediation B2.7
 *
 * Fills the cross-org MUTATION gaps not covered by tenant-isolation.test.ts
 * (which covers document view/list/upload-to-project/approve, and correspondence
 * mutations). Here we assert an Org B admin CANNOT mutate Org A's existing
 * documents or their files:
 *   - edit metadata (PUT /:id)
 *   - delete the document (DELETE /:id)
 *   - upload a file/revision to it (POST /:id/files)
 *   - delete one of its files (DELETE /:id/files/:fileId)
 *
 * Invariant: every cross-org mutation MUST return 403 or 404 — never any 2xx.
 * A 2xx here is a Critical cross-tenant breach.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable, orgConfigTable } from "@workspace/db";

interface Fx {
  orgA: { id: number };
  orgB: { id: number };
  userA: { id: number };
  userB: { id: number };
  projectA: { id: number };
  documentId: number;
  fileId: number;
}
let fx: Fx;

/** A cross-org mutation must be denied — 403 or 404, NEVER any 2xx. */
function expectDenied(status: number, label: string) {
  expect(status, `${label} — expected 403/404 (cross-org denied), got ${status}`).not.toBeLessThan(400);
  expect([401, 403, 404], `${label} — expected 401/403/404, got ${status}`).toContain(status);
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();

  const orgA = await createOrg({ name: "Mut Org Alpha", code: "MUTA" });
  const orgB = await createOrg({ name: "Mut Org Beta", code: "MUTB" });
  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@muta.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@mutb.test" });

  // Deterministic storage for Org A so a (denied) upload never depends on ambient config.
  await db.insert(orgConfigTable).values({ organizationId: orgA.id, storageType: "onpremise", storagePath: "/tmp/edms-b27" });

  const projectA = await createProject({ organizationId: orgA.id, createdById: userA.id, name: "Alpha Mut Project", code: "MUTA-001" });

  const [doc] = await db.insert(documentsTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    createdById: userA.id,
    documentNumber: "MUT-DOC-001",
    title: "Alpha Confidential",
    revision: "A",
    status: "draft",
  }).returning();

  const [file] = await db.insert(documentFilesTable).values({
    documentId: doc.id,
    organizationId: orgA.id,
    fileUrl: "/api/storage/onpremise/0/0/document/alpha.pdf",
    fileName: "alpha.pdf",
    fileSize: 1234,
    fileType: "application/pdf",
    uploadedById: userA.id,
    sha256: null,
  }).returning();

  fx = { orgA, orgB, userA, userB, projectA, documentId: doc.id, fileId: file.id };
});

afterAll(async () => { await truncateAllTables(); });

describe("Documents — cross-org MUTATION isolation (B2.7)", () => {
  const asB = () => authHeader("admin", fx.userB.id, fx.orgB.id, "admin@mutb.test");

  it("Org B admin cannot EDIT (PUT) Org A's document", async () => {
    const res = await api()
      .put(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}`)
      .set(asB())
      .send({ title: "Hijacked Title", status: "approved" });
    expectDenied(res.status, "PUT document");
    // Confirm the DB was not mutated
    const db = getTestDb();
    const [row] = await db.select().from(documentsTable);
    expect(row.title, "document title must be unchanged after denied cross-org edit").toBe("Alpha Confidential");
  });

  it("Org B admin cannot DELETE Org A's document", async () => {
    const res = await api()
      .delete(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}`)
      .set(asB());
    expectDenied(res.status, "DELETE document");
    const db = getTestDb();
    const rows = await db.select().from(documentsTable);
    expect(rows.length, "document must still exist after denied cross-org delete").toBe(1);
  });

  it("Org B admin cannot UPLOAD a file/revision to Org A's document", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}/files`)
      .set(asB())
      .attach("files", Buffer.from("evil revision"), { filename: "evil.pdf", contentType: "application/pdf" });
    expectDenied(res.status, "POST document files");
    const db = getTestDb();
    const files = await db.select().from(documentFilesTable);
    expect(files.length, "no file may be added to Org A's document by Org B").toBe(1);
  });

  it("Org B admin cannot DELETE a file on Org A's document", async () => {
    const res = await api()
      .delete(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}/files/${fx.fileId}`)
      .set(asB());
    expectDenied(res.status, "DELETE document file");
    const db = getTestDb();
    const files = await db.select().from(documentFilesTable);
    expect(files.length, "Org A's file must survive a denied cross-org delete").toBe(1);
  });
});
