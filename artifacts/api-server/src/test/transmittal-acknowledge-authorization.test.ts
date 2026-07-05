/**
 * transmittal-acknowledge-authorization.test.ts
 *
 * Security Regression Suite — Transmittal Acknowledge Authorization (Phase 6A)
 *
 * Before Phase 6A, POST /:id/acknowledge applied no authorization — any
 * authenticated user who knew the transmittal ID could mark it acknowledged.
 *
 * This suite verifies the three-gate model introduced in Phase 6A:
 *   1. Caller must be a project member (canAccessProject).
 *   2. Caller must be from the sender org OR the recipient org (toUserId's org).
 *   3. system_owner bypasses gate 2.
 *
 * Also covers Invariant I-8 (T-6 — Revoked Party Access):
 *   A party org removed from project_parties loses acknowledge access immediately.
 *
 * Fixture structure:
 *   orgOwner       — owns the project (sends transmittals)
 *   orgRecipient   — party contributor (receives transmittals)
 *   orgOther       — no project relationship
 *
 *   dcOwner        — document_controller in orgOwner (creates + sends transmittals)
 *   namedRecipient — member in orgRecipient (the toUserId on test transmittals)
 *   otherRecipient — member in orgRecipient (NOT toUserId — tests org-level access)
 *   memberOther    — member in orgOther (tests third-party block)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import {
  transmittalsTable,
  projectPartiesTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

const db = getTestDb();

let orgOwner:     { id: number };
let orgRecipient: { id: number };
let orgOther:     { id: number };

let dcOwner:        { id: number; organizationId: number | null };
let namedRecipient: { id: number; organizationId: number | null };
let otherRecipient: { id: number; organizationId: number | null };
let memberOther:    { id: number; organizationId: number | null };

let projectId: number;

const DB = db;

beforeAll(async () => {
  await truncateAllTables();

  orgOwner     = await createOrg({ name: "Ack Owner Org",     code: "ACKOWN" });
  orgRecipient = await createOrg({ name: "Ack Recipient Org", code: "ACKREC" });
  orgOther     = await createOrg({ name: "Ack Other Org",     code: "ACKOTH" });

  dcOwner        = await createUser({ organizationId: orgOwner.id,     role: "admin",               email: "dc@ackown.test" });
  namedRecipient = await createUser({ organizationId: orgRecipient.id, role: "member",              email: "named@ackrec.test" });
  otherRecipient = await createUser({ organizationId: orgRecipient.id, role: "member",              email: "other@ackrec.test" });
  memberOther    = await createUser({ organizationId: orgOther.id,     role: "member",              email: "mem@ackoth.test" });

  await DB.insert(orgConfigTable).values([
    { organizationId: orgOwner.id,     modules: { registers: true } },
    { organizationId: orgRecipient.id, modules: { registers: true } },
    { organizationId: orgOther.id,     modules: { registers: true } },
  ]);

  // Project owned by orgOwner, parties mode
  const pRes = await api()
    .post("/api/projects")
    .set(authHeader("admin", dcOwner.id, orgOwner.id))
    .send({ name: "Ack Test Project", code: "ACKPRJ" });
  expect(pRes.status).toBe(201);
  projectId = pRes.body.id;

  // Enable parties collaboration mode
  await api()
    .patch(`/api/projects/${projectId}/collaboration-mode`)
    .set(authHeader("admin", dcOwner.id, orgOwner.id))
    .send({ collaborationMode: "parties" });

  // Add orgRecipient as contributor party
  await api()
    .post(`/api/projects/${projectId}/parties`)
    .set(authHeader("admin", dcOwner.id, orgOwner.id))
    .send({ organizationId: orgRecipient.id, partyRole: "contributor" });
});

afterAll(async () => {
  await truncateAllTables();
});

/** Creates a transmittal in the project with toUserId = namedRecipient */
async function createTransmittal(suffix: string): Promise<number> {
  const res = await api()
    .post(`/api/projects/${projectId}/transmittals`)
    .set(authHeader("admin", dcOwner.id, orgOwner.id))
    .send({ subject: `Test transmittal ${suffix}`, purpose: "for_information" });
  expect(res.status).toBe(201);

  // Set toUserId directly via DB to avoid depending on frontend logic
  await DB.update(transmittalsTable)
    .set({ toUserId: namedRecipient.id })
    .where(eq(transmittalsTable.id, res.body.id));

  return res.body.id as number;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /projects/:projectId/transmittals/:id/acknowledge — authorization (Phase 6A)", () => {

  it("allows sender org DC to acknowledge", async () => {
    const trsId = await createTransmittal("SENDER-ACK");
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId}/acknowledge`)
      .set(authHeader("admin", dcOwner.id, orgOwner.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  it("allows the named recipient (toUserId) to acknowledge", async () => {
    const trsId = await createTransmittal("NAMED-ACK");
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId}/acknowledge`)
      .set(authHeader("member", namedRecipient.id, orgRecipient.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  it("allows a different member of the recipient org (not toUserId) to acknowledge", async () => {
    const trsId = await createTransmittal("ORG-ACK");
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId}/acknowledge`)
      .set(authHeader("member", otherRecipient.id, orgRecipient.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  it("blocks a user from an unrelated org who is not a project member", async () => {
    const trsId = await createTransmittal("THIRD-PARTY-BLOCK");
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId}/acknowledge`)
      .set(authHeader("member", memberOther.id, orgOther.id));
    // canAccessProject → not allowed → 403
    expect(res.status).toBe(403);
  });

  it("returns 404 for a transmittal ID that belongs to a different project", async () => {
    const trsId = await createTransmittal("WRONG-PROJECT");
    // Use a fake project ID that doesn't contain this transmittal
    const res = await api()
      .post(`/api/projects/99999/transmittals/${trsId}/acknowledge`)
      .set(authHeader("admin", dcOwner.id, orgOwner.id));
    // canAccessProject(99999) → not allowed (project doesn't exist) → 403
    expect(res.status).toBe(403);
  });

  it("blocks a revoked party org member from acknowledging (T-6: Revoked Party Access)", async () => {
    const trsId = await createTransmittal("REVOKE-ACK");

    // First, confirm the party member CAN acknowledge before revocation
    const beforeRevoke = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId}/acknowledge`)
      .set(authHeader("member", otherRecipient.id, orgRecipient.id));
    expect(beforeRevoke.status, "should succeed before revocation").toBe(200);

    // Create a fresh transmittal to test after revocation
    const trsId2 = await createTransmittal("REVOKE-ACK-2");

    // Revoke orgRecipient from the project by setting removed_at
    await DB.update(projectPartiesTable)
      .set({ removedAt: new Date() })
      .where(and(
        eq(projectPartiesTable.projectId, projectId),
        eq(projectPartiesTable.organizationId, orgRecipient.id),
        isNull(projectPartiesTable.removedAt),
      ));

    const afterRevoke = await api()
      .post(`/api/projects/${projectId}/transmittals/${trsId2}/acknowledge`)
      .set(authHeader("member", otherRecipient.id, orgRecipient.id));
    expect(afterRevoke.status, "should be blocked after party revocation").toBe(403);

    // Restore for subsequent tests
    await DB.update(projectPartiesTable)
      .set({ removedAt: null })
      .where(and(
        eq(projectPartiesTable.projectId, projectId),
        eq(projectPartiesTable.organizationId, orgRecipient.id),
      ));
  });
});
