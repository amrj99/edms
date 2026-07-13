/**
 * transmittal-authz-regression.test.ts — Remediation B2.4-FIX (post-fix)
 *
 * Confirms the router-gate + object-scoping + party guard do not over-block and
 * do close the residual vectors:
 *   - in-org authorized user still succeeds;
 *   - mixed-id (authorized project, foreign transmittal) is denied;
 *   - an item/document from another transmittal/project is rejected;
 *   - a party contributor is denied the destructive actions (no ceiling
 *     capability) but can still create (create_transmittal capability intact);
 *   - a party observer is denied.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import {
  transmittalsTable, transmittalItemsTable, documentsTable, orgConfigTable, projectsTable, projectPartiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

interface Fx {
  orgA: { id: number }; orgCtrb: { id: number }; orgObs: { id: number };
  adminA: { id: number }; ctrbUser: { id: number }; obsUser: { id: number };
  projectA: { id: number }; projectA2: { id: number };
  trsA: number; itemA: number; docA: number;
  trsA2: number; itemA2: number; docA2: number;
}
let fx: Fx;
let seq = 0;
const db = () => getTestDb();

const asAdminA = () => authHeader("admin", fx.adminA.id, fx.orgA.id, "admin@rega.test");
const asCtrb = () => authHeader("admin", fx.ctrbUser.id, fx.orgCtrb.id, "admin@regc.test");
const asObs = () => authHeader("admin", fx.obsUser.id, fx.orgObs.id, "admin@rego.test");

async function mkTransmittal(projectId: number, orgId: number, createdById: number): Promise<{ trsId: number; itemId: number; docId: number }> {
  const s = `RG${++seq}`;
  const [trs] = await db().insert(transmittalsTable).values({
    organizationId: orgId, projectId, createdById, transmittalNumber: `RTN-${s}`,
    subject: `Reg ${s}`, purpose: "for_information", shareToken: `sh-${s}`,
  }).returning();
  const [doc] = await db().insert(documentsTable).values({
    organizationId: orgId, projectId, createdById, documentNumber: `RGD-${s}`, title: `Doc ${s}`, revision: "A", status: "draft",
  }).returning();
  const [item] = await db().insert(transmittalItemsTable).values({ transmittalId: trs.id, documentId: doc.id, purpose: "for_review" }).returning();
  return { trsId: trs.id, itemId: item.id, docId: doc.id };
}

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "Reg Owner A", code: "REGOWNA" });
  const orgCtrb = await createOrg({ name: "Reg Contributor", code: "REGCTRB" });
  const orgObs = await createOrg({ name: "Reg Observer", code: "REGOBS" });
  const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@rega.test" });
  const ctrbUser = await createUser({ organizationId: orgCtrb.id, role: "admin", email: "admin@regc.test" });
  const obsUser = await createUser({ organizationId: orgObs.id, role: "admin", email: "admin@rego.test" });
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { registers: true } },
    { organizationId: orgCtrb.id, modules: { registers: true } },
    { organizationId: orgObs.id, modules: { registers: true } },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: adminA.id, name: "Reg Project", code: "REG-001" });
  const projectA2 = await createProject({ organizationId: orgA.id, createdById: adminA.id, name: "Reg Project 2", code: "REG-002" });
  await db().update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, projectA.id));
  await db().insert(projectPartiesTable).values([
    { projectId: projectA.id, organizationId: orgCtrb.id, partyRole: "contributor", addedById: adminA.id },
    { projectId: projectA.id, organizationId: orgObs.id, partyRole: "observer", addedById: adminA.id },
  ]);

  const a = await mkTransmittal(projectA.id, orgA.id, adminA.id);
  const a2 = await mkTransmittal(projectA2.id, orgA.id, adminA.id);
  fx = {
    orgA, orgCtrb, orgObs, adminA, ctrbUser, obsUser, projectA, projectA2,
    trsA: a.trsId, itemA: a.itemId, docA: a.docId, trsA2: a2.trsId, itemA2: a2.itemId, docA2: a2.docId,
  };
});
afterAll(async () => { await truncateAllTables(); });

const Tp = (pid: number) => `/api/projects/${pid}/transmittals`;

describe("B2.4-FIX — in-org authorized success (not over-blocked)", () => {
  it("owner admin can PUT its own transmittal", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    const res = await api().put(`${Tp(fx.projectA.id)}/${t.trsId}`).set(asAdminA()).send({ subject: "Edited OK" });
    expect(res.status, JSON.stringify(res.body).slice(0, 140)).toBe(200);
  });
  it("owner admin can add an item with a document from the same project", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    const res = await api().post(`${Tp(fx.projectA.id)}/${t.trsId}/items`).set(asAdminA()).send({ documentId: t.docId, purpose: "for_review" });
    expect(res.status).toBe(201);
  });
  it("owner admin can delete an item of its own transmittal", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    const res = await api().delete(`${Tp(fx.projectA.id)}/${t.trsId}/items/${t.itemId}`).set(asAdminA());
    expect(res.status).toBe(200);
  });
});

describe("B2.4-FIX — object scoping (mixed-id / cross-transmittal / cross-project)", () => {
  it("PUT with a transmittal id from ANOTHER project (mixed-id) → 404", async () => {
    const res = await api().put(`${Tp(fx.projectA.id)}/${fx.trsA2}`).set(asAdminA()).send({ subject: "X" });
    expect(res.status).toBe(404);
    // trsA2's subject unchanged
    const [row] = await db().select().from(transmittalsTable).where(eq(transmittalsTable.id, fx.trsA2));
    expect(row.subject).not.toBe("X");
  });
  it("DELETE an item that belongs to a DIFFERENT transmittal → 404, item survives", async () => {
    const res = await api().delete(`${Tp(fx.projectA.id)}/${fx.trsA}/items/${fx.itemA2}`).set(asAdminA());
    expect(res.status).toBe(404);
    const rows = await db().select().from(transmittalItemsTable).where(eq(transmittalItemsTable.id, fx.itemA2));
    expect(rows.length).toBe(1);
  });
  it("POST item with a document from ANOTHER project → 404", async () => {
    const res = await api().post(`${Tp(fx.projectA.id)}/${fx.trsA}/items`).set(asAdminA()).send({ documentId: fx.docA2, purpose: "for_review" });
    expect(res.status).toBe(404);
  });
});

describe("B2.4-FIX — party ceiling (destructive denied, create intact)", () => {
  it("party contributor is DENIED PUT (no ceiling capability)", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    const res = await api().put(`${Tp(fx.projectA.id)}/${t.trsId}`).set(asCtrb()).send({ subject: "party-edit" });
    expect(res.status).toBe(403);
    const [row] = await db().select().from(transmittalsTable).where(eq(transmittalsTable.id, t.trsId));
    expect(row.subject).not.toBe("party-edit");
  });
  it("party contributor is DENIED item delete and upload-attachment", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    expect((await api().delete(`${Tp(fx.projectA.id)}/${t.trsId}/items/${t.itemId}`).set(asCtrb())).status).toBe(403);
    expect((await api().post(`${Tp(fx.projectA.id)}/${t.trsId}/upload-attachment`).set(asCtrb())
      .send({ fileName: "p.pdf", fileUrl: "/api/storage/onpremise/1/1/document/p.pdf" })).status).toBe(403);
  });
  it("party contributor CAN still create a transmittal (create_transmittal capability intact)", async () => {
    const res = await api().post(`${Tp(fx.projectA.id)}`).set(asCtrb()).send({ subject: "party creates", purpose: "for_information" });
    expect([200, 201], `create got ${res.status}`).toContain(res.status);
  });
  it("party OBSERVER is DENIED destructive actions", async () => {
    const t = await mkTransmittal(fx.projectA.id, fx.orgA.id, fx.adminA.id);
    expect((await api().put(`${Tp(fx.projectA.id)}/${t.trsId}`).set(asObs()).send({ subject: "obs" })).status).toBe(403);
  });
});
