/**
 * party-contributor-upload.test.ts — Remediation B2.3a (Alternative A)
 *
 * A party CONTRIBUTOR from Org B uploads a file to a document owned by Org A
 * (the project owner). Proves the approved storage-ownership decision:
 *
 *   Storage placement, storage-key prefix, quota accounting, and the plan/quota
 *   gates follow the DOCUMENT OWNER's org (Org A) — never the uploader's org
 *   (Org B). The AUDIT records the real actor (Org B user) but attributes the
 *   row to the owning org (Org A). Compensation on failure deletes from Org A.
 *
 * Also pins the authorization edges:
 *   - party OBSERVER may NOT upload (party ceiling),
 *   - a non-member org may NOT upload (project access gate).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { sql, eq } from "drizzle-orm";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { documentsTable, documentFilesTable, organizationsTable, orgConfigTable, projectsTable, projectPartiesTable } from "@workspace/db";

import * as storageMod from "../lib/orgStorage.js";
import { storageQuota } from "../lib/storage-quota.js";

interface Fx {
  orgA: { id: number }; orgB: { id: number }; orgObs: { id: number }; orgOut: { id: number };
  userA: { id: number }; userB: { id: number }; userObs: { id: number }; userOut: { id: number };
  projectA: { id: number }; docId: number; base: string;
}
let fx: Fx;

const P = (pid: number) => `/api/projects/${pid}/documents`;

async function fileCount(docId: number): Promise<number> {
  return (await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.documentId, docId))).length;
}
async function usedMb(orgId: number): Promise<number> {
  const [o] = await getTestDb().select({ v: organizationsTable.storageUsedMb }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return o?.v ?? 0;
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "b23a-party-"));

  const orgA = await createOrg({ name: "Owner Org A", code: "OWNA" });
  const orgB = await createOrg({ name: "Party Contributor Org B", code: "PRTB" });
  const orgObs = await createOrg({ name: "Party Observer Org", code: "POBS" });
  const orgOut = await createOrg({ name: "Outsider Org", code: "OUTS" });

  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@owna.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@prtb.test" });
  const userObs = await createUser({ organizationId: orgObs.id, role: "admin", email: "admin@pobs.test" });
  const userOut = await createUser({ organizationId: orgOut.id, role: "admin", email: "admin@outs.test" });

  // Owner org uses on-premise storage rooted at our temp base.
  await db.insert(orgConfigTable).values({ organizationId: orgA.id, storageType: "onpremise", storagePath: base });

  const projectA = await createProject({ organizationId: orgA.id, createdById: userA.id, name: "Owner Project", code: "OWNA-001" });
  await db.update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, projectA.id));

  // Org B is a CONTRIBUTOR party; Org Obs is an OBSERVER party; Org Out is not a party.
  await db.insert(projectPartiesTable).values([
    { projectId: projectA.id, organizationId: orgB.id, partyRole: "contributor", addedById: userA.id },
    { projectId: projectA.id, organizationId: orgObs.id, partyRole: "observer", addedById: userA.id },
  ]);

  const [doc] = await db.insert(documentsTable).values({
    organizationId: orgA.id, projectId: projectA.id, createdById: userA.id,
    documentNumber: "OWNA-DOC", title: "Owner Document", revision: "A", status: "draft",
  }).returning();

  fx = { orgA, orgB, orgObs, orgOut, userA, userB, userObs, userOut, projectA, docId: doc.id, base };
});
afterAll(async () => {
  try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* ignore */ }
  await truncateAllTables();
});
afterEach(() => { vi.restoreAllMocks(); });

const asContributor = () => authHeader("admin", fx.userB.id, fx.orgB.id, "admin@prtb.test");
const upload = (h: Record<string, string>, name: string, body: string) =>
  api().post(`${P(fx.projectA.id)}/${fx.docId}/files`).set(h).attach("files", Buffer.from(body), { filename: name, contentType: "application/pdf" });

describe("B2.3a — Party Contributor upload follows the DOCUMENT OWNER's org (Alternative A)", () => {
  it("Org B contributor upload → stored under Org A, quota A grows, quota B unchanged, audit=A/actor=B", async () => {
    const up = vi.spyOn(storageMod, "uploadBuffer");
    const beforeFiles = await fileCount(fx.docId);
    const beforeA = await usedMb(fx.orgA.id);
    const beforeB = await usedMb(fx.orgB.id);

    const res = await upload(asContributor(), "party.pdf", "PARTY-CONTRIB");
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);

    // Storage tenant = Org A (owner), NOT Org B (uploader).
    expect(up.mock.calls[0][0].organizationId).toBe(fx.orgA.id);
    const stored = await up.mock.results[0].value;
    const orgARoot = path.resolve(fx.base, String(fx.orgA.id));
    expect(path.resolve(stored.objectPath).startsWith(orgARoot)).toBe(true);

    // serveUrl encodes Org A.
    expect(res.body.files[0].fileUrl).toContain(`/onpremise/${fx.orgA.id}/`);

    // Row added; Org A quota +1; Org B quota unchanged.
    expect(await fileCount(fx.docId)).toBe(beforeFiles + 1);
    expect(await usedMb(fx.orgA.id)).toBe(beforeA + 1);
    expect(await usedMb(fx.orgB.id)).toBe(beforeB);

    // Audit: attributed to Org A, actor is the Org B user.
    const a: any = await getTestDb().execute(
      sql`SELECT organization_id, user_id FROM audit_logs WHERE entity_id = ${fx.docId} AND action='update' AND entity_type='document' ORDER BY id DESC LIMIT 1`,
    );
    expect(Number(a.rows[0].organization_id)).toBe(fx.orgA.id);
    expect(Number(a.rows[0].user_id)).toBe(fx.userB.id);
  });

  it("compensation on tx failure deletes from Org A storage; quota A unchanged, no row", async () => {
    const up = vi.spyOn(storageMod, "uploadBuffer");
    vi.spyOn(storageQuota, "increment").mockRejectedValueOnce(new Error("quota boom → rollback"));
    const beforeFiles = await fileCount(fx.docId);
    const beforeA = await usedMb(fx.orgA.id);

    const res = await upload(asContributor(), "party-fail.pdf", "PARTY-FAIL");
    expect(res.status).toBe(500);

    const stored = await up.mock.results[0].value;
    expect(fs.existsSync(stored.objectPath)).toBe(false); // compensated from Org A tree
    expect(await fileCount(fx.docId)).toBe(beforeFiles);
    expect(await usedMb(fx.orgA.id)).toBe(beforeA);
  });

  it("party OBSERVER may NOT upload (party ceiling) → 403, no row", async () => {
    const before = await fileCount(fx.docId);
    const res = await upload(authHeader("admin", fx.userObs.id, fx.orgObs.id, "admin@pobs.test"), "obs.pdf", "OBS");
    expect(res.status).toBe(403);
    expect(await fileCount(fx.docId)).toBe(before);
  });

  it("non-member org may NOT upload (project access gate) → 403, no row", async () => {
    const before = await fileCount(fx.docId);
    const res = await upload(authHeader("admin", fx.userOut.id, fx.orgOut.id, "admin@outs.test"), "out.pdf", "OUT");
    expect(res.status).toBe(403);
    expect(await fileCount(fx.docId)).toBe(before);
  });
});
