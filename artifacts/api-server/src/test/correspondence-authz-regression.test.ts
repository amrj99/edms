/**
 * correspondence-authz-regression.test.ts — Remediation B2.5-FIX (post-fix)
 *
 * Confirms the org-scoping does not over-block the owner org and denies a party
 * caller (a different org) the destructive correspondence mutations — consistent
 * with Party Policy v1 (correspondence mutations are org-scoped; a party from
 * another org is not the owning org, so it is denied).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { correspondenceTable, orgConfigTable, projectsTable, projectPartiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface Fx {
  orgA: { id: number }; orgCtrb: { id: number };
  adminA: { id: number }; ctrbUser: { id: number };
  projectA: { id: number };
}
let fx: Fx;
let seq = 0;
const db = () => getTestDb();
const C = () => `/api/projects/${fx.projectA.id}/correspondence`;
const asAdminA = () => authHeader("admin", fx.adminA.id, fx.orgA.id, "admin@cra.test");
const asCtrb = () => authHeader("admin", fx.ctrbUser.id, fx.orgCtrb.id, "admin@crc.test");

async function freshCorr(): Promise<number> {
  const s = `CR${++seq}`;
  const [c] = await db().insert(correspondenceTable).values({
    subject: `Corr ${s}`, type: "letter", folder: "inbox", status: "sent",
    organizationId: fx.orgA.id, projectId: fx.projectA.id, fromUserId: fx.adminA.id, scope: "project",
  }).returning();
  return c.id;
}
const getCorr = async (id: number) => (await db().select().from(correspondenceTable).where(eq(correspondenceTable.id, id)))[0];

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "CR Owner A", code: "CROWNA" });
  const orgCtrb = await createOrg({ name: "CR Contributor", code: "CRCTRB" });
  const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@cra.test" });
  const ctrbUser = await createUser({ organizationId: orgCtrb.id, role: "admin", email: "admin@crc.test" });
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { correspondence: true } },
    { organizationId: orgCtrb.id, modules: { correspondence: true } },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: adminA.id, name: "CR Project", code: "CR-001" });
  await db().update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, projectA.id));
  await db().insert(projectPartiesTable).values({ projectId: projectA.id, organizationId: orgCtrb.id, partyRole: "contributor", addedById: adminA.id });
  fx = { orgA, orgCtrb, adminA, ctrbUser, projectA };
});
afterAll(async () => { await truncateAllTables(); });

describe("B2.5-FIX — owner org success (not over-blocked)", () => {
  it("owner admin can edit its own correspondence", async () => {
    const id = await freshCorr();
    const res = await api().put(`${C()}/${id}`).set(asAdminA()).send({ subject: "Edited OK" });
    expect(res.status, JSON.stringify(res.body).slice(0, 140)).toBe(200);
    expect((await getCorr(id)).subject).toBe("Edited OK");
  });
  it("owner admin can attach to its own correspondence", async () => {
    const id = await freshCorr();
    const res = await api().post(`${C()}/${id}/attachments`).set(asAdminA())
      .send({ fileName: "ok.pdf", fileUrl: "/api/storage/onpremise/1/1/document/ok.pdf", fileSize: 1 });
    expect(res.status).toBe(201);
  });
  it("owner admin can delete its own correspondence", async () => {
    const id = await freshCorr();
    const res = await api().delete(`${C()}/${id}`).set(asAdminA());
    expect([200, 204]).toContain(res.status);
    expect(await getCorr(id)).toBeUndefined();
  });
});

describe("B2.5-FIX — party caller (another org) denied destructive mutations (Party Policy v1)", () => {
  it("party contributor is DENIED PUT / attach / delete; correspondence unchanged", async () => {
    const id = await freshCorr();
    const before = await getCorr(id);
    expect((await api().put(`${C()}/${id}`).set(asCtrb()).send({ subject: "party" })).status).toBeGreaterThanOrEqual(400);
    expect((await api().post(`${C()}/${id}/attachments`).set(asCtrb()).send({ fileName: "p.pdf", fileUrl: "/x" })).status).toBeGreaterThanOrEqual(400);
    expect((await api().delete(`${C()}/${id}`).set(asCtrb())).status).toBeGreaterThanOrEqual(400);
    const after = await getCorr(id);
    expect(after.subject).toBe(before.subject);
    expect(after).toBeTruthy();
  });
});
