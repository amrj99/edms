/**
 * registers-linked-document.test.ts
 *
 * Locks the minimum fix: ITR + NCR create/update accept linkedDocumentId, but ONLY for a
 * document in the SAME organization AND the SAME project (no cross-tenant / cross-project
 * links). Update preserves an existing link when the field is omitted.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { documentsTable, orgConfigTable } from "@workspace/db";

// registers routes are gated by requireModule("registers") — enable modules for the org.
async function enableModules(orgId: number): Promise<void> {
  await getTestDb().insert(orgConfigTable).values({
    organizationId: orgId,
    modules: { dashboard: true, deliverables: true, registers: true, notifications: true, chat: true, correspondence: true, meetings: true, workflow_engine: true },
    aiEnabled: false, aiPrivacyMode: false,
  });
}

let orgA: number, orgB: number, adminA: number, projA1: number, projA2: number, projB: number;
let docA1: number, docA2: number, docB: number;

async function mkDoc(org: number, project: number, creator: number, num: string): Promise<number> {
  const db = getTestDb();
  const [d] = await db.insert(documentsTable).values({
    organizationId: org, projectId: project, createdById: creator,
    documentNumber: num, title: `Doc ${num}`, documentType: "general", discipline: "general",
  }).returning();
  return d.id;
}

beforeAll(async () => {
  await truncateAllTables();
  const oA = await createOrg({ name: "Reg Org A" }); orgA = oA.id;
  const oB = await createOrg({ name: "Reg Org B" }); orgB = oB.id;
  const uA = await createUser({ organizationId: orgA, role: "admin", email: "regadmin@a.edms" }); adminA = uA.id;
  const uB = await createUser({ organizationId: orgB, role: "admin", email: "regadmin@b.edms" });
  await enableModules(orgA);
  await enableModules(orgB);
  projA1 = (await createProject({ organizationId: orgA })).id;
  projA2 = (await createProject({ organizationId: orgA })).id;
  projB  = (await createProject({ organizationId: orgB })).id;
  docA1 = await mkDoc(orgA, projA1, adminA, "A1-DOC-001");
  docA2 = await mkDoc(orgA, projA2, adminA, "A2-DOC-001");
  docB  = await mkDoc(orgB, projB,  uB.id, "B-DOC-001");
});

const hdr = () => authHeader("admin", adminA, orgA, "regadmin@a.edms");

describe("registers linkedDocumentId — ITR", () => {
  it("create with same-org same-project doc → persisted", async () => {
    const r = await api().post(`/api/projects/${projA1}/inspection-requests`)
      .set(hdr()).send({ requestNumber: "ITR-LINK-1", linkedDocumentId: docA1 });
    expect(r.status).toBe(201);
    expect(r.body.linkedDocumentId).toBe(docA1);
  });

  it("create with cross-ORG doc → 400 (rejected)", async () => {
    const r = await api().post(`/api/projects/${projA1}/inspection-requests`)
      .set(hdr()).send({ requestNumber: "ITR-LINK-XORG", linkedDocumentId: docB });
    expect(r.status).toBe(400);
  });

  it("create with cross-PROJECT (same org) doc → 400 (rejected)", async () => {
    const r = await api().post(`/api/projects/${projA1}/inspection-requests`)
      .set(hdr()).send({ requestNumber: "ITR-LINK-XPROJ", linkedDocumentId: docA2 });
    expect(r.status).toBe(400);
  });

  it("create without linkedDocumentId → 201, null link", async () => {
    const r = await api().post(`/api/projects/${projA1}/inspection-requests`)
      .set(hdr()).send({ requestNumber: "ITR-NOLINK" });
    expect(r.status).toBe(201);
    expect(r.body.linkedDocumentId ?? null).toBeNull();
  });

  it("update preserves link when field omitted; sets/clears when provided", async () => {
    const c = await api().post(`/api/projects/${projA1}/inspection-requests`)
      .set(hdr()).send({ requestNumber: "ITR-UPD", linkedDocumentId: docA1 });
    const id = c.body.id;
    // omit linkedDocumentId → preserved
    const u1 = await api().put(`/api/projects/${projA1}/inspection-requests/${id}`)
      .set(hdr()).send({ status: "scheduled" });
    expect(u1.status).toBe(200);
    expect(u1.body.linkedDocumentId).toBe(docA1);
    // explicit null → cleared
    const u2 = await api().put(`/api/projects/${projA1}/inspection-requests/${id}`)
      .set(hdr()).send({ linkedDocumentId: null });
    expect(u2.status).toBe(200);
    expect(u2.body.linkedDocumentId ?? null).toBeNull();
    // cross-org on update → 400
    const u3 = await api().put(`/api/projects/${projA1}/inspection-requests/${id}`)
      .set(hdr()).send({ linkedDocumentId: docB });
    expect(u3.status).toBe(400);
  });
});

describe("registers linkedDocumentId — NCR (regression)", () => {
  it("create with same-org same-project doc → persisted", async () => {
    const r = await api().post(`/api/projects/${projA1}/ncr-records`)
      .set(hdr()).send({ reportNumber: "NCR-LINK-1", linkedDocumentId: docA1 });
    expect(r.status).toBe(201);
    expect(r.body.linkedDocumentId).toBe(docA1);
  });

  it("create with cross-ORG doc → 400", async () => {
    const r = await api().post(`/api/projects/${projA1}/ncr-records`)
      .set(hdr()).send({ reportNumber: "NCR-XORG", linkedDocumentId: docB });
    expect(r.status).toBe(400);
  });
});
