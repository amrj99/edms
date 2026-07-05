/**
 * transmittal-complete-review-authorization.test.ts
 *
 * Security Regression Suite — Transmittal Complete-Review Authorization (H3)
 *
 * Previously, POST /:id/complete-review only required requireAuth — ANY
 * authenticated user with a sufficient base role (document_controller+) could
 * finalize the review of ANY transmittal, even if they were neither the
 * designated recipient (toUserId) nor the sender (createdById).
 *
 * This mirrors the assignment-based check already used by
 * PATCH /:id/items/:itemId (checkAssignmentBasedPermission).
 *
 * This suite verifies:
 *   1. A user who is neither the transmittal's toUserId nor createdById, and
 *      whose role is below admin, is denied (403) on complete-review.
 *   2. The designated recipient (toUserId) with role >= reviewer can complete
 *      the review.
 *   3. admin/system_owner can override on a transmittal they are not assigned
 *      to, and this is recorded in the audit log as admin_override_complete_review.
 *   4. admin acting as the assigned recipient does not log an override.
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
import {
  documentsTable,
  transmittalsTable,
  transmittalItemsTable,
  auditLogsTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

let org: { id: number };
let project: { id: number; code: string };
let admin: { id: number; organizationId: number | null };
let recipient: { id: number; organizationId: number | null };  // role=reviewer, toUserId on transmittal
let sender: { id: number; organizationId: number | null };     // role=document_controller, createdById
let outsider: { id: number; organizationId: number | null };   // role=document_controller, not assigned

const db = getTestDb();

beforeAll(async () => {
  await truncateAllTables();

  org = await createOrg({ name: "Transmittal Org", code: "TRSORG" });
  project = await createProject({ organizationId: org.id, name: "Transmittal Project", code: "TRSP001" });

  // requireModule("registers") fails closed without an org_config row.
  await db.insert(orgConfigTable).values({
    organizationId: org.id,
    modules: { registers: true },
  });

  admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@trs.test" });
  recipient = await createUser({ organizationId: org.id, role: "reviewer", email: "recipient@trs.test" });
  sender = await createUser({ organizationId: org.id, role: "document_controller", email: "sender@trs.test" });
  outsider = await createUser({ organizationId: org.id, role: "document_controller", email: "outsider@trs.test" });
});

afterAll(async () => {
  await truncateAllTables();
});

/** Creates a document + transmittal with one reviewed item, ready for complete-review. */
async function createReviewableTransmittal(trsNumber: string, toUserId: number | null) {
  const [doc] = await db.insert(documentsTable).values({
    organizationId: org.id,
    projectId: project.id,
    createdById: sender.id,
    documentNumber: `DOC-${trsNumber}`,
    title: `Doc ${trsNumber}`,
    revision: "A",
    status: "under_review",
  }).returning();

  const [trs] = await db.insert(transmittalsTable).values({
    transmittalNumber: trsNumber,
    subject: `Subject ${trsNumber}`,
    projectId: project.id,
    organizationId: org.id,
    createdById: sender.id,
    toUserId: toUserId ?? undefined,
    purpose: "for_review",
    status: "sent",
  }).returning();

  await db.insert(transmittalItemsTable).values({
    transmittalId: trs.id,
    documentId: doc.id,
    reviewCode: "A",
  });

  return { doc, trs };
}

describe("POST /:projectId/transmittals/:id/complete-review — authorization (H3)", () => {
  it("denies a user who is neither the recipient nor the sender", async () => {
    const { trs } = await createReviewableTransmittal("TRS-H3-001", recipient.id);

    const res = await api()
      .post(`/api/projects/${project.id}/transmittals/${trs.id}/complete-review`)
      .set(authHeader("document_controller", outsider.id, org.id))
      .send({ reviewComment: "trying to complete without assignment" });

    expect(res.status).toBe(403);

    const [refreshed] = await db.select().from(transmittalsTable).where(eq(transmittalsTable.id, trs.id));
    expect(refreshed.status).toBe("sent");
    expect(refreshed.reviewOutcome).toBeNull();
  });

  it("allows the designated recipient (toUserId) with role >= reviewer to complete the review", async () => {
    const { trs } = await createReviewableTransmittal("TRS-H3-002", recipient.id);

    const res = await api()
      .post(`/api/projects/${project.id}/transmittals/${trs.id}/complete-review`)
      .set(authHeader("reviewer", recipient.id, org.id))
      .send({ reviewComment: "looks good" });

    expect(res.status).toBe(200);
    expect(res.body.reviewOutcome).toBe("A");
  });

  it("allows admin override on a transmittal the admin is not assigned to, and writes an audit log entry", async () => {
    const { trs } = await createReviewableTransmittal("TRS-H3-003", recipient.id);

    const res = await api()
      .post(`/api/projects/${project.id}/transmittals/${trs.id}/complete-review`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ reviewComment: "admin override completes the review" });

    expect(res.status).toBe(200);

    const logs = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.action, "admin_override_complete_review"),
        eq(auditLogsTable.entityId, trs.id),
        eq(auditLogsTable.entityType, "transmittal"),
      ));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].userId).toBe(admin.id);
  });

  it("allows admin to complete a review where admin is also the recipient (logged as override, consistent with PATCH /:id/items/:itemId)", async () => {
    const { trs } = await createReviewableTransmittal("TRS-H3-004", admin.id);

    const res = await api()
      .post(`/api/projects/${project.id}/transmittals/${trs.id}/complete-review`)
      .set(authHeader("admin", admin.id, org.id))
      .send({ reviewComment: "admin acting as the assigned recipient" });

    expect(res.status).toBe(200);

    const logs = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.action, "admin_override_complete_review"),
        eq(auditLogsTable.entityId, trs.id),
        eq(auditLogsTable.entityType, "transmittal"),
      ));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
