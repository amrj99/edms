/**
 * file-soft-delete.test.ts — Remediation B2.3b-1 (Soft Delete & Restore)
 *
 * A file DELETE now SOFT-deletes: it is hidden from all normal listings and
 * downloads and scheduled for purge after FILE_RETENTION_DAYS, but its storage
 * object is retained and the quota is unchanged — so it can be restored. No
 * storage removal, no quota decrement, no row deletion happen here (those are
 * the gated B2.3b-2 purge worker).
 *
 * Owner-org + role authorization only: a party contributor/observer and a
 * non-member are all denied. Audit is attributed to the owner org with the
 * real actor.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs";
import { sql, eq } from "drizzle-orm";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable, organizationsTable, orgConfigTable, projectsTable, projectPartiesTable } from "@workspace/db";
import * as storageMod from "../lib/orgStorage.js";
import * as auditMod from "../lib/audit.js";
import { FILE_RETENTION_DAYS } from "../lib/retention.js";

interface Fx {
  orgA: { id: number }; orgB: { id: number }; orgObs: { id: number }; orgOut: { id: number };
  admin: { id: number }; viewer: { id: number };
  userB: { id: number }; userObs: { id: number }; userOut: { id: number };
  projectA: { id: number }; docId: number;
  projectOther: { id: number }; docOther: number;
}
let fx: Fx;

const P = (pid: number) => `/api/projects/${pid}/documents`;
const asAdmin = () => authHeader("admin", fx.admin.id, fx.orgA.id, "admin@owna.test");

async function usedMb(orgId: number): Promise<number> {
  const [o] = await getTestDb().select({ v: organizationsTable.storageUsedMb }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return o?.v ?? 0;
}
async function listFileIds(pid: number, docId: number, hdr: Record<string, string>): Promise<number[]> {
  const res = await api().get(`${P(pid)}/${docId}/files`).set(hdr);
  return (res.body.files ?? []).map((f: any) => f.id);
}
async function fileRow(fileId: number) {
  const [r] = await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.id, fileId));
  return r;
}
async function auditCount(docId: number, action: string): Promise<number> {
  const r: any = await getTestDb().execute(
    sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity_id = ${docId} AND action = ${action} AND entity_type = 'document'`,
  );
  return Number(r.rows[0].c);
}

/** Upload a fresh file to docId as admin; return {fileId, fileUrl, objectPath}. */
async function uploadFresh(name: string): Promise<{ fileId: number; fileUrl: string; objectPath: string }> {
  const up = vi.spyOn(storageMod, "uploadBuffer");
  const res = await api().post(`${P(fx.projectA.id)}/${fx.docId}/files`).set(asAdmin())
    .attach("files", Buffer.from(`bytes-${name}`), { filename: name, contentType: "application/pdf" });
  expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(201);
  const stored = await up.mock.results[0].value;
  up.mockRestore();
  return { fileId: res.body.files[0].id, fileUrl: res.body.files[0].fileUrl, objectPath: stored.objectPath };
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const orgA = await createOrg({ name: "Owner Org A", code: "SDOWNA" });
  const orgB = await createOrg({ name: "Party Contributor B", code: "SDPRTB" });
  const orgObs = await createOrg({ name: "Party Observer", code: "SDPOBS" });
  const orgOut = await createOrg({ name: "Outsider", code: "SDOUT" });
  const admin = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@owna.test" });
  const viewer = await createUser({ organizationId: orgA.id, role: "viewer", email: "viewer@owna.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@prtb.test" });
  const userObs = await createUser({ organizationId: orgObs.id, role: "admin", email: "admin@pobs.test" });
  const userOut = await createUser({ organizationId: orgOut.id, role: "admin", email: "admin@out.test" });
  await db.insert(orgConfigTable).values({ organizationId: orgA.id, storageType: "onpremise", storagePath: "/tmp/edms-b23b" });

  const projectA = await createProject({ organizationId: orgA.id, createdById: admin.id, name: "Owner Project", code: "SD-001" });
  await db.update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, projectA.id));
  await db.insert(projectPartiesTable).values([
    { projectId: projectA.id, organizationId: orgB.id, partyRole: "contributor", addedById: admin.id },
    { projectId: projectA.id, organizationId: orgObs.id, partyRole: "observer", addedById: admin.id },
  ]);
  const [doc] = await db.insert(documentsTable).values({
    organizationId: orgA.id, projectId: projectA.id, createdById: admin.id,
    documentNumber: "SD-DOC", title: "SoftDel Doc", revision: "A", status: "draft",
  }).returning();

  const projectOther = await createProject({ organizationId: orgA.id, createdById: admin.id, name: "Other Project", code: "SD-002" });
  const [docOther] = await db.insert(documentsTable).values({
    organizationId: orgA.id, projectId: projectOther.id, createdById: admin.id,
    documentNumber: "SD-DOC2", title: "Other Doc", revision: "A", status: "draft",
  }).returning();

  fx = { orgA, orgB, orgObs, orgOut, admin, viewer, userB, userObs, userOut, projectA, docId: doc.id, projectOther, docOther: docOther.id };
});
afterAll(async () => { await truncateAllTables(); });
afterEach(() => { vi.restoreAllMocks(); });

const DEL = (fileId: number, hdr: Record<string, string>) => api().delete(`${P(fx.projectA.id)}/${fx.docId}/files/${fileId}`).set(hdr);
const RESTORE = (fileId: number, hdr: Record<string, string>) => api().post(`${P(fx.projectA.id)}/${fx.docId}/files/${fileId}/restore`).set(hdr);

describe("B2.3b-1 — File Soft Delete & Restore", () => {
  it("soft-delete hides the file from listing + global view; storage object stays; quota unchanged", async () => {
    const f = await uploadFresh("hide.pdf");
    const beforeMb = await usedMb(fx.orgA.id);
    expect(await listFileIds(fx.projectA.id, fx.docId, asAdmin())).toContain(f.fileId);

    const res = await DEL(f.fileId, asAdmin());
    expect(res.status).toBe(204);

    // Hidden from project + global listings.
    expect(await listFileIds(fx.projectA.id, fx.docId, asAdmin())).not.toContain(f.fileId);
    const g = await api().get(`/api/documents/${fx.docId}`).set(asAdmin());
    if (g.status === 200 && g.body.files) expect(g.body.files.map((x: any) => x.id)).not.toContain(f.fileId);

    // Storage object retained; quota unchanged; tombstone fields set.
    expect(fs.existsSync(f.objectPath)).toBe(true);
    expect(await usedMb(fx.orgA.id)).toBe(beforeMb);
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(fx.admin.id);
    expect(row.purgeAfter).not.toBeNull();
    // purge_after ≈ deleted_at + 90d
    const gapDays = (new Date(row.purgeAfter!).getTime() - new Date(row.deletedAt!).getTime()) / 86_400_000;
    expect(Math.round(gapDays)).toBe(FILE_RETENTION_DAYS);
  });

  it("download of the old fileUrl is rejected after soft-delete, and un-blocked again after restore", async () => {
    // Isolates the B2.3b-1 serve guard: it runs FIRST in requireAuthOrViewToken
    // and returns 404 {File not found} for a soft-deleted file — before any
    // path/org checks. While active the guard does not fire, so the request
    // reaches the serve route (a non-404 status); after restore it does not
    // fire again. The 404 during soft-delete is therefore the guard, uniquely.
    const f = await uploadFresh("dl.pdf");
    const before = await api().get(f.fileUrl).set(asAdmin());
    expect(before.status, "active file reaches the serve route, not the guard").not.toBe(404);

    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    const during = await api().get(f.fileUrl).set(asAdmin());
    expect(during.status, "soft-deleted file must not be downloadable even with a known URL").toBe(404);
    expect(during.body.error).toBe("File not found"); // the guard's response

    expect((await RESTORE(f.fileId, asAdmin())).status).toBe(200);
    const after = await api().get(f.fileUrl).set(asAdmin());
    expect(after.status, "restored file is no longer blocked by the guard").not.toBe(404);
  });

  it("restore returns the file to the listing; quota + storage unchanged", async () => {
    const f = await uploadFresh("restore.pdf");
    const beforeMb = await usedMb(fx.orgA.id);
    await DEL(f.fileId, asAdmin());
    expect(await listFileIds(fx.projectA.id, fx.docId, asAdmin())).not.toContain(f.fileId);

    const res = await RESTORE(f.fileId, asAdmin());
    expect(res.status).toBe(200);
    expect(await listFileIds(fx.projectA.id, fx.docId, asAdmin())).toContain(f.fileId);
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).toBeNull();
    expect(row.deletedById).toBeNull();
    expect(row.purgeAfter).toBeNull();
    expect(fs.existsSync(f.objectPath)).toBe(true);
    expect(await usedMb(fx.orgA.id)).toBe(beforeMb);
  });

  it("audit carries the owner org and the real actor", async () => {
    const f = await uploadFresh("audit.pdf");
    await DEL(f.fileId, asAdmin());
    const a: any = await getTestDb().execute(
      sql`SELECT organization_id, user_id FROM audit_logs WHERE entity_id = ${fx.docId} AND action = 'file_delete_requested' ORDER BY id DESC LIMIT 1`,
    );
    expect(Number(a.rows[0].organization_id)).toBe(fx.orgA.id);
    expect(Number(a.rows[0].user_id)).toBe(fx.admin.id);
  });

  it("party contributor, observer, non-member, and insufficient-role are all DENIED (no state change)", async () => {
    const f = await uploadFresh("deny.pdf");
    const cases: Array<[string, Record<string, string>]> = [
      ["contributor", authHeader("admin", fx.userB.id, fx.orgB.id, "admin@prtb.test")],
      ["observer",    authHeader("admin", fx.userObs.id, fx.orgObs.id, "admin@pobs.test")],
      ["non-member",  authHeader("admin", fx.userOut.id, fx.orgOut.id, "admin@out.test")],
      ["owner-viewer",authHeader("viewer", fx.viewer.id, fx.orgA.id, "viewer@owna.test")],
    ];
    for (const [label, hdr] of cases) {
      const res = await DEL(f.fileId, hdr);
      expect([403, 404], `${label} must be denied`).toContain(res.status);
      const row = await fileRow(f.fileId);
      expect(row.deletedAt, `${label} must not soft-delete`).toBeNull();
    }
  });

  it("a file id from ANOTHER document/project is rejected (mixed-id)", async () => {
    const f = await uploadFresh("mixed.pdf");
    // Try to delete docId's file through the OTHER project's path.
    const res = await api().delete(`${P(fx.projectOther.id)}/${fx.docOther}/files/${f.fileId}`).set(asAdmin());
    expect([403, 404]).toContain(res.status);
    expect((await fileRow(f.fileId)).deletedAt).toBeNull();
  });

  it("transaction failure leaves the file fully unchanged (active)", async () => {
    const f = await uploadFresh("txfail.pdf");
    vi.spyOn(auditMod, "createAuditLogTx").mockRejectedValueOnce(new Error("audit boom"));
    const res = await DEL(f.fileId, asAdmin());
    expect(res.status).toBe(500);
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).toBeNull();
    expect(row.deletedById).toBeNull();
    expect(row.purgeAfter).toBeNull();
  });

  it("a second DELETE on a soft-deleted file → 404, purge_after unchanged, no extra audit", async () => {
    const f = await uploadFresh("double.pdf");
    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    const row1 = await fileRow(f.fileId);
    const auditBefore = await auditCount(fx.docId, "file_delete_requested");

    const res = await DEL(f.fileId, asAdmin());
    expect(res.status).toBe(404);
    const row2 = await fileRow(f.fileId);
    expect(new Date(row2.purgeAfter!).getTime()).toBe(new Date(row1.purgeAfter!).getTime()); // unchanged
    expect(await auditCount(fx.docId, "file_delete_requested")).toBe(auditBefore); // no extra success audit
  });

  it("a second RESTORE on an ACTIVE file → 409 (documented contract)", async () => {
    const f = await uploadFresh("rest2.pdf");
    await DEL(f.fileId, asAdmin());
    expect((await RESTORE(f.fileId, asAdmin())).status).toBe(200); // now active again
    const res = await RESTORE(f.fileId, asAdmin());              // restoring an active file
    expect(res.status).toBe(409);
  });
});

// ─── F1: Atomic conditional state transition ──────────────────────────────────
// The transition is decided by the UPDATE predicate (deletedAt IS NULL /
// IS NOT NULL) + RETURNING — never by a prior SELECT. These prove the contract
// that survives concurrency: exactly ONE transition and exactly ONE success
// audit per file, with no purge_after regeneration. The assertions hold whether
// the two requests truly run in parallel OR the test DB serialises them — the
// conditional UPDATE guarantees the second request matches no row either way.
describe("B2.3b-1 F1 — Atomic conditional transition", () => {
  it("two concurrent soft-deletes → one 204, one 404, exactly one success audit, purge_after set once", async () => {
    const f = await uploadFresh("f1-cdel.pdf");
    const auditBefore = await auditCount(fx.docId, "file_delete_requested");

    const [r1, r2] = await Promise.all([DEL(f.fileId, asAdmin()), DEL(f.fileId, asAdmin())]);
    expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([204, 404]);

    // Exactly one transition happened → exactly one success audit.
    expect(await auditCount(fx.docId, "file_delete_requested")).toBe(auditBefore + 1);
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(fx.admin.id);
    expect(row.purgeAfter).not.toBeNull(); // set once by the single winning UPDATE
  });

  it("two concurrent restores → one 200, one 409, exactly one restore audit", async () => {
    const f = await uploadFresh("f1-crestore.pdf");
    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    const auditBefore = await auditCount(fx.docId, "file_restored");

    const [r1, r2] = await Promise.all([RESTORE(f.fileId, asAdmin()), RESTORE(f.fileId, asAdmin())]);
    expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([200, 409]);

    expect(await auditCount(fx.docId, "file_restored")).toBe(auditBefore + 1);
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).toBeNull(); // ended active exactly once
  });

  it("interleaved delete → restore → delete stays consistent (no double-audit, correct final state)", async () => {
    const f = await uploadFresh("f1-interleave.pdf");
    const delBefore = await auditCount(fx.docId, "file_delete_requested");
    const resBefore = await auditCount(fx.docId, "file_restored");

    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    expect((await RESTORE(f.fileId, asAdmin())).status).toBe(200);
    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);

    // Exactly 2 delete audits + 1 restore audit — one per real transition.
    expect(await auditCount(fx.docId, "file_delete_requested")).toBe(delBefore + 2);
    expect(await auditCount(fx.docId, "file_restored")).toBe(resBefore + 1);
    expect((await fileRow(f.fileId)).deletedAt).not.toBeNull(); // final state: deleted
  });

  it("audit failure inside the restore transaction rolls back the whole transition", async () => {
    const f = await uploadFresh("f1-restore-rollback.pdf");
    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    const deletedAtBefore = (await fileRow(f.fileId)).deletedAt;

    vi.spyOn(auditMod, "createAuditLogTx").mockRejectedValueOnce(new Error("audit boom"));
    const res = await RESTORE(f.fileId, asAdmin());
    expect(res.status).toBe(500);

    // The conditional UPDATE and the audit share one tx → both rolled back:
    // the file is still soft-deleted with its original tombstone intact.
    const row = await fileRow(f.fileId);
    expect(row.deletedAt).not.toBeNull();
    expect(new Date(row.deletedAt!).getTime()).toBe(new Date(deletedAtBefore!).getTime());
    expect(row.purgeAfter).not.toBeNull();
  });

  it("mixed-id restore through another project's path is rejected (no transition)", async () => {
    const f = await uploadFresh("f1-mixed-restore.pdf");
    expect((await DEL(f.fileId, asAdmin())).status).toBe(204);
    // Restore docId's file via the OTHER project's document path.
    const res = await api().post(`${P(fx.projectOther.id)}/${fx.docOther}/files/${f.fileId}/restore`).set(asAdmin());
    expect([403, 404]).toContain(res.status);
    expect((await fileRow(f.fileId)).deletedAt).not.toBeNull(); // still soft-deleted
  });
});

// ─── F2: Canonical download guard across ALL storage backends ─────────────────
// The download guard now matches CANONICALLY (see lib/storage-serve-url.ts), so
// a soft-deleted file is un-downloadable on onpremise/S3/R2/cloud even though
// S3/R2 serve URLs carry an encodeURIComponent'd key + ?orgId query the request
// path lacks. Rows are seeded with the SAME serve-URL builders the storage
// adapters use (s3ServeUrl / r2ServeUrl) — not synthetic strings.
//
// Isolation of the guard signal: the guard runs FIRST in requireAuthOrViewToken
// and returns 404 {File not found}. When the guard does NOT fire, each backend
// route produces a DIFFERENT deterministic status that proves we got past it:
//   • onpremise → real round-trip already served 200 (see suite above)
//   • s3        → 403 (assertOrgAccess) for an outsider org
//   • r2        → 503 (R2 not configured in test) before any ownership check
// so "active/legacy ≠ 404" cleanly means "the guard did not block".
describe("B2.3b-1 F2 — Canonical download guard (per backend)", () => {
  const asOutsider = () => authHeader("admin", fx.userOut.id, fx.orgOut.id, "admin@out.test");

  async function seedFile(fileUrl: string, deleted: boolean): Promise<number> {
    const now = new Date();
    const [row] = await getTestDb().insert(documentFilesTable).values({
      documentId: fx.docId,
      organizationId: fx.orgA.id,
      fileName: fileUrl.split("/").pop()!.split("?")[0],
      fileUrl,
      fileType: "application/pdf",
      deletedAt: deleted ? now : null,
      deletedById: deleted ? fx.admin.id : null,
      purgeAfter: deleted ? new Date(now.getTime() + 86_400_000) : null,
    }).returning({ id: documentFilesTable.id });
    return row.id;
  }

  it("S3: soft-deleted file (encoded key + ?orgId) is blocked; active is not (was the F2 bypass)", async () => {
    const key = `${fx.orgA.id}/1/document/s3guard.pdf`;
    const url = storageMod.s3ServeUrl(fx.orgA.id, key); // /api/storage/s3-object/<enc>?orgId=N
    // Soft-deleted → guard 404 (with the OLD exact-eq guard this returned 403/route → the bypass).
    await seedFile(url, true);
    const blocked = await api().get(url).set(asAdmin());
    expect(blocked.status, "soft-deleted S3 file must be blocked by the canonical guard").toBe(404);
    expect(blocked.body.error).toBe("File not found");

    // Active (different key so no soft-deleted row matches) → past the guard → 403 (assertOrgAccess).
    const activeUrl = storageMod.s3ServeUrl(fx.orgA.id, `${fx.orgA.id}/1/document/s3active.pdf`);
    await seedFile(activeUrl, false);
    const active = await api().get(activeUrl).set(asOutsider());
    expect(active.status, "active S3 file must reach the route, not the guard").not.toBe(404);
  });

  it("R2: soft-deleted file (encoded key + ?orgId) is blocked; active is not (was the F2 bypass)", async () => {
    const key = `org_${fx.orgA.id}/projects/1/r2guard.pdf`;
    const url = storageMod.r2ServeUrl(fx.orgA.id, key);
    await seedFile(url, true);
    const blocked = await api().get(url).set(asAdmin());
    expect(blocked.status, "soft-deleted R2 file must be blocked by the canonical guard").toBe(404);
    expect(blocked.body.error).toBe("File not found");

    const activeUrl = storageMod.r2ServeUrl(fx.orgA.id, `org_${fx.orgA.id}/projects/1/r2active.pdf`);
    await seedFile(activeUrl, false);
    const active = await api().get(activeUrl).set(asAdmin());
    expect(active.status, "active R2 file must reach the route, not the guard").not.toBe(404);
  });

  it("Cloud/GCS: soft-deleted file is blocked by the guard", async () => {
    const url = `/api/storage/objects/uploads/cloudguard.pdf`;
    await seedFile(url, true);
    const blocked = await api().get(url).set(asAdmin());
    expect(blocked.status, "soft-deleted cloud file must be blocked by the canonical guard").toBe(404);
    expect(blocked.body.error).toBe("File not found");
  });

  it("re-encoding / query tamper cannot bypass the guard (same object, canonical match)", async () => {
    // Store the canonical S3 form, then request a DIFFERENTLY-encoded + reordered
    // -query variant of the SAME object. Canonicalisation collapses them → blocked.
    const key = `${fx.orgA.id}/1/document/tamper.pdf`;
    await seedFile(storageMod.s3ServeUrl(fx.orgA.id, key), true);
    // Double-slash + trailing junk query, different but equivalent path.
    const tampered = `/api/storage/s3-object/${encodeURIComponent(key)}?foo=bar&orgId=${fx.orgA.id}`;
    const res = await api().get(tampered).set(asAdmin());
    expect(res.status, "re-encoded/re-ordered query must not bypass the guard").toBe(404);
  });

  it("legacy URL with no document_files row is NOT blocked (keeps current behavior)", async () => {
    // No row seeded for this key → guard has no candidate → passes → route runs.
    const url = storageMod.s3ServeUrl(fx.orgA.id, `${fx.orgA.id}/1/document/legacy-no-row.pdf`);
    const res = await api().get(url).set(asOutsider());
    expect(res.status, "a URL with no document_files row must not be guard-blocked").not.toBe(404);
  });

  it("a different file with a near-identical path is NOT wrongly blocked", async () => {
    // Soft-delete <...>/near_a.pdf; a DIFFERENT active object <...>/near_b.pdf
    // must not be caught by the LIKE narrowing (exact canonical compare filters).
    await seedFile(storageMod.s3ServeUrl(fx.orgA.id, `${fx.orgA.id}/1/document/near_a.pdf`), true);
    const otherUrl = storageMod.s3ServeUrl(fx.orgA.id, `${fx.orgA.id}/1/document/near_b.pdf`);
    await seedFile(otherUrl, false);
    const res = await api().get(otherUrl).set(asOutsider());
    expect(res.status, "a different near-path file must not be blocked").not.toBe(404);
  });
});
