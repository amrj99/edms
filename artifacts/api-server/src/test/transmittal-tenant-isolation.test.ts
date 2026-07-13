/**
 * transmittal-tenant-isolation.test.ts — Remediation B2.4-FIX
 *
 * Cross-org MUTATION isolation for the transmittals router. Each test asserts
 * the SECURE outcome (a caller from another org is denied AND no state changes).
 * Before the fix these are RED (the handlers mutate cross-org); after the fix
 * they are GREEN.
 *
 * Every assertion checks BOTH the HTTP status (denied) AND that the underlying
 * row is unchanged/undeleted — so a real cross-org write is distinguished from
 * a path that merely errors for another reason.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { transmittalsTable, transmittalItemsTable, documentsTable, orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface Fx { orgA: { id: number }; orgB: { id: number }; userA: { id: number }; userB: { id: number }; projectA: { id: number }; }
let fx: Fx;
let seq = 0;

const db = () => getTestDb();
const T = () => `/api/projects/${fx.projectA.id}/transmittals`;
const asAttacker = () => authHeader("admin", fx.userB.id, fx.orgB.id, "admin@attb.test");

function expectDenied(status: number, label: string) {
  expect([401, 403, 404], `${label} — expected denial, got ${status}`).toContain(status);
}

/** Fresh OrgA transmittal + document + item + a share token. */
async function fresh(): Promise<{ trsId: number; itemId: number; docId: number; subject: string }> {
  const s = `TZ${++seq}`;
  const [trs] = await db().insert(transmittalsTable).values({
    organizationId: fx.orgA.id, projectId: fx.projectA.id, createdById: fx.userA.id,
    transmittalNumber: `TN-${s}`,
    subject: `Subject ${s}`, purpose: "for_information", shareToken: `share-${s}`,
  }).returning();
  const [doc] = await db().insert(documentsTable).values({
    organizationId: fx.orgA.id, projectId: fx.projectA.id, createdById: fx.userA.id,
    documentNumber: `TZD-${s}`, title: `Doc ${s}`, revision: "A", status: "draft",
  }).returning();
  const [item] = await db().insert(transmittalItemsTable).values({
    transmittalId: trs.id, documentId: doc.id, purpose: "for_review",
  }).returning();
  return { trsId: trs.id, itemId: item.id, docId: doc.id, subject: trs.subject };
}

const getTrs = async (id: number) => (await db().select().from(transmittalsTable).where(eq(transmittalsTable.id, id)))[0];
const itemCount = async (trsId: number) => (await db().select().from(transmittalItemsTable).where(eq(transmittalItemsTable.transmittalId, trsId))).length;
const itemExists = async (itemId: number) => (await db().select().from(transmittalItemsTable).where(eq(transmittalItemsTable.id, itemId))).length > 0;

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "TZ Owner A", code: "TZOWNA" });
  const orgB = await createOrg({ name: "TZ Attacker B", code: "TZATTB" });
  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@owna.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@attb.test" });
  // Both orgs legitimately have the registers module, so requireModule does not
  // mask the per-handler authorization gap.
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { registers: true } },
    { organizationId: orgB.id, modules: { registers: true } },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: userA.id, name: "TZ Project", code: "TZ-001" });
  fx = { orgA, orgB, userA, userB, projectA };
});
afterAll(async () => { await truncateAllTables(); });

describe("B2.4 — cross-org transmittal mutation is DENIED (no state change)", () => {
  it("PUT /:id — cross-org edit denied; subject unchanged", async () => {
    const { trsId, subject } = await fresh();
    const res = await api().put(`${T()}/${trsId}`).set(asAttacker()).send({ subject: "HIJACKED", purpose: "for_review" });
    expectDenied(res.status, "PUT /:id");
    expect((await getTrs(trsId)).subject).toBe(subject);
  });

  it("POST /:id/upload-attachment — cross-org attachment denied; no item/document added", async () => {
    const { trsId } = await fresh();
    const before = await itemCount(trsId);
    const res = await api().post(`${T()}/${trsId}/upload-attachment`).set(asAttacker())
      .send({ fileName: "evil.pdf", fileUrl: "/api/storage/onpremise/9/9/document/evil.pdf", fileSize: 1 });
    expectDenied(res.status, "upload-attachment");
    expect(await itemCount(trsId)).toBe(before);
  });

  it("DELETE /:id/items/:itemId — cross-org item delete denied; item survives", async () => {
    const { trsId, itemId } = await fresh();
    const res = await api().delete(`${T()}/${trsId}/items/${itemId}`).set(asAttacker());
    expectDenied(res.status, "DELETE item");
    expect(await itemExists(itemId)).toBe(true);
  });

  it("DELETE /:id/share — cross-org share revoke denied; shareToken intact", async () => {
    const { trsId } = await fresh();
    const res = await api().delete(`${T()}/${trsId}/share`).set(asAttacker());
    expectDenied(res.status, "DELETE share");
    expect((await getTrs(trsId)).shareToken).not.toBeNull();
  });

  it("POST /:id/complete-review — cross-org review completion denied; transmittal unchanged", async () => {
    const { trsId } = await fresh();
    const before = await getTrs(trsId);
    const res = await api().post(`${T()}/${trsId}/complete-review`).set(asAttacker()).send({ reviewOutcome: "approved" });
    expectDenied(res.status, "complete-review");
    const after = await getTrs(trsId);
    expect(after.status).toBe(before.status);
    expect(after.reviewOutcome).toBe(before.reviewOutcome);
  });

  it("POST /:id/items — cross-org item add denied; no item added", async () => {
    const { trsId, docId } = await fresh();
    const before = await itemCount(trsId);
    const res = await api().post(`${T()}/${trsId}/items`).set(asAttacker()).send({ documentId: docId, purpose: "for_review" });
    expectDenied(res.status, "POST items");
    expect(await itemCount(trsId)).toBe(before);
  });

  it("PATCH /:id/items/:itemId — cross-org item edit denied; item unchanged", async () => {
    const { trsId, itemId } = await fresh();
    const res = await api().patch(`${T()}/${trsId}/items/${itemId}`).set(asAttacker()).send({ reviewCode: "D" });
    expectDenied(res.status, "PATCH item");
    const [item] = await db().select().from(transmittalItemsTable).where(eq(transmittalItemsTable.id, itemId));
    expect(item.reviewCode ?? null).toBeNull();
  });
});
