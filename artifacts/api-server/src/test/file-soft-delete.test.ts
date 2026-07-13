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
