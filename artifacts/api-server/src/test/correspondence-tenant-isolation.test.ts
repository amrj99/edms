/**
 * correspondence-tenant-isolation.test.ts — Remediation B2.5
 *
 * Cross-org MUTATION isolation for the correspondence router. Each test asserts
 * the SECURE outcome (a caller from another org is denied AND no state change).
 * RED before the fix (the handlers mutate cross-org), GREEN after.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { correspondenceTable, correspondenceAttachmentsTable, orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface Fx { orgA: { id: number }; orgB: { id: number }; userA: { id: number }; userB: { id: number }; projectA: { id: number }; }
let fx: Fx;
let seq = 0;
const db = () => getTestDb();
const C = () => `/api/projects/${fx.projectA.id}/correspondence`;
const asAttacker = () => authHeader("admin", fx.userB.id, fx.orgB.id, "admin@cattb.test");
function expectDenied(status: number, label: string) {
  expect([401, 403, 404], `${label} — expected denial, got ${status}`).toContain(status);
}

async function fresh(): Promise<{ corrId: number; attId: number; subject: string }> {
  const s = `CZ${++seq}`;
  const [corr] = await db().insert(correspondenceTable).values({
    subject: `Subject ${s}`, type: "letter", folder: "inbox", status: "sent",
    organizationId: fx.orgA.id, projectId: fx.projectA.id, fromUserId: fx.userA.id, scope: "project",
  }).returning();
  const [att] = await db().insert(correspondenceAttachmentsTable).values({
    correspondenceId: corr.id, fileName: `f-${s}.pdf`, fileUrl: `/api/storage/onpremise/1/1/document/f-${s}.pdf`, fileSize: 1,
  }).returning();
  return { corrId: corr.id, attId: att.id, subject: corr.subject };
}
const getCorr = async (id: number) => (await db().select().from(correspondenceTable).where(eq(correspondenceTable.id, id)))[0];
const attCount = async (corrId: number) => (await db().select().from(correspondenceAttachmentsTable).where(eq(correspondenceAttachmentsTable.correspondenceId, corrId))).length;

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "CZ Owner A", code: "CZOWNA" });
  const orgB = await createOrg({ name: "CZ Attacker B", code: "CZATTB" });
  const userA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@cowna.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "admin@cattb.test" });
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { correspondence: true } },
    { organizationId: orgB.id, modules: { correspondence: true } },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: userA.id, name: "CZ Project", code: "CZ-001" });
  fx = { orgA, orgB, userA, userB, projectA };
});
afterAll(async () => { await truncateAllTables(); });

describe("B2.5 — cross-org correspondence mutation is DENIED (no state change)", () => {
  it("PUT /:id — cross-org edit denied; subject unchanged", async () => {
    const { corrId, subject } = await fresh();
    const res = await api().put(`${C()}/${corrId}`).set(asAttacker()).send({ subject: "HIJACKED" });
    expectDenied(res.status, "PUT /:id");
    expect((await getCorr(corrId)).subject).toBe(subject);
  });

  it("POST /:id/attachments — cross-org attachment denied; no attachment added", async () => {
    const { corrId } = await fresh();
    const before = await attCount(corrId);
    const res = await api().post(`${C()}/${corrId}/attachments`).set(asAttacker())
      .send({ fileName: "evil.pdf", fileUrl: "/api/storage/onpremise/9/9/document/evil.pdf", fileSize: 1 });
    expectDenied(res.status, "POST attachments");
    expect(await attCount(corrId)).toBe(before);
  });

  it("POST /:id/recall — cross-org recall denied; not recalled", async () => {
    const { corrId } = await fresh();
    const res = await api().post(`${C()}/${corrId}/recall`).set(asAttacker()).send({});
    expectDenied(res.status, "recall");
    expect((await getCorr(corrId)).recalledAt).toBeNull();
  });

  it("POST /:id/reply — cross-org reply denied; no reply created", async () => {
    const { corrId } = await fresh();
    const res = await api().post(`${C()}/${corrId}/reply`).set(asAttacker()).send({ subject: "Re", body: "evil", type: "letter" });
    expectDenied(res.status, "reply");
    // No child correspondence created with this parent.
    const children = await db().select().from(correspondenceTable).where(eq(correspondenceTable.parentId, corrId));
    expect(children.length).toBe(0);
  });

  it("DELETE /:id — cross-org delete denied; correspondence survives", async () => {
    const { corrId } = await fresh();
    const res = await api().delete(`${C()}/${corrId}`).set(asAttacker());
    expectDenied(res.status, "DELETE /:id");
    expect(await getCorr(corrId)).toBeTruthy();
  });
});
