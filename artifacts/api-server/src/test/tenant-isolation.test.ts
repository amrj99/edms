/**
 * tenant-isolation.test.ts
 *
 * Security Regression Suite — Tenant Isolation
 *
 * These tests verify the MOST CRITICAL security invariant in a multi-tenant SaaS:
 * Organization A can NEVER access Organization B's data.
 *
 * ── What we test ──────────────────────────────────────────────────────────────
 *
 *   1. Projects     — Org B user cannot view Org A's project
 *   2. Documents    — Org B user cannot view a document in Org A's project
 *   3. Correspondence — Org B user cannot view Org A's correspondence threads
 *   4. Notifications — User can only see their own notifications (user-scoped)
 *   5. Search       — Search results are scoped to caller's org
 *   6. Audit Logs   — Org B admin cannot read Org A's audit log
 *
 * ── Test strategy ────────────────────────────────────────────────────────────
 *
 *   Each test:
 *     1. Seeds minimal data in Org A (owner org of the resource)
 *     2. Makes the request as an Org B user (the attacker)
 *     3. Asserts the response is 403 or 404 — NEVER 200
 *
 *   We do NOT use transaction rollback here because global-setup handles schema,
 *   and we truncate between describe blocks via afterAll.
 *   Tests run in a single fork (singleFork: true in vitest.config.ts) so
 *   sequential cleanup is safe.
 *
 * ── Why 403 OR 404? ──────────────────────────────────────────────────────────
 *
 *   Both are acceptable. 404 is actually preferable ("resource doesn't exist
 *   from your perspective") because it doesn't leak existence information.
 *   What is NEVER acceptable: 200, 201, or any 2xx.
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
  correspondenceTable,
  correspondenceAttachmentsTable,
  notificationsTable,
  auditLogsTable,
  orgConfigTable,
  chatGroupsTable,
  chatGroupMembersTable,
  chatMessagesTable,
} from "@workspace/db";

// ─── Shared state ─────────────────────────────────────────────────────────────

interface TestFixture {
  orgA: { id: number };
  orgB: { id: number };
  userA: { id: number; organizationId: number };  // admin in Org A
  userB: { id: number; organizationId: number };  // admin in Org B
  projectA: { id: number };
  documentId: number;
  correspondenceId: number;
  attachmentId: number;  // attachment on Org A's correspondence
  notificationId: number;
  auditLogId: number;
  chatGroupId: number;   // chat group owned by Org A
  chatMessageId: number; // message in Org A's chat group
}

let fx: TestFixture;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();

  const db = getTestDb();

  // Create two separate organizations
  const orgA = await createOrg({ name: "Org Alpha", code: "ALPHA" });
  const orgB = await createOrg({ name: "Org Beta",  code: "BETA" });

  // Create an admin user in each org
  const userA = await createUser({ organizationId: orgA.id, role: "admin",  email: "admin@alpha.test" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin",  email: "admin@beta.test" });

  // Create a project in Org A
  const projectA = await createProject({
    organizationId: orgA.id,
    createdById: userA.id,
    name: "Alpha Secret Project",
    code: "ALPHA-001",
  });

  // Insert a document in Org A's project
  const [doc] = await db.insert(documentsTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    createdById: userA.id,
    documentNumber: "DOC-001",
    title: "Confidential Engineering Drawing",
    revision: "A",
    status: "draft",
  }).returning();

  // Insert a correspondence thread in Org A
  const [corr] = await db.insert(correspondenceTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    subject: "Internal Alpha Memo",
    type: "internal",
    fromUserId: userA.id,
    status: "draft",
    referenceNumber: "CORR-001",
  }).returning();

  // Insert an attachment on Org A's correspondence (used in A-2 isolation test)
  const [att] = await db.insert(correspondenceAttachmentsTable).values({
    correspondenceId: corr.id,
    fileName: "alpha-confidential.pdf",
    fileUrl: "https://storage.example.com/alpha-confidential.pdf",
    fileSize: 12345,
  }).returning();

  // Grant BOTH orgs module access so the module gate does not shadow the
  // tenant-isolation check in mutation tests. chat is included so cross-org
  // chat tests hit the isolation check rather than the module gate.
  await db.insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { correspondence: true, dashboard: true, deliverables: true, registers: true, notifications: true, chat: true } },
    { organizationId: orgB.id, modules: { correspondence: true, dashboard: true, deliverables: true, registers: true, notifications: true, chat: true } },
  ]);

  // Create a chat group in Org A (userA is the group admin)
  const [chatGroup] = await db.insert(chatGroupsTable).values({
    name: "Alpha Internal Chat",
    type: "general",
    organizationId: orgA.id,
    createdById: userA.id,
  }).returning();
  await db.insert(chatGroupMembersTable).values({ groupId: chatGroup.id, userId: userA.id, role: "admin" });

  // Insert a message in Org A's group (owned by userA)
  const [chatMsg] = await db.insert(chatMessagesTable).values({
    groupId: chatGroup.id,
    userId: userA.id,
    content: "Confidential Alpha discussion",
  }).returning();

  // Insert a notification for userA (should NOT be visible to userB)
  const [notif] = await db.insert(notificationsTable).values({
    userId: userA.id,
    type: "document_uploaded",
    title: "Alpha document updated",
    message: "DOC-001 was updated",
    projectId: projectA.id,
  }).returning();

  // Insert an audit log entry for Org A
  const [auditLog] = await db.insert(auditLogsTable).values({
    action: "document.create",
    userId: userA.id,
    organizationId: orgA.id,
    entityType: "document",
    entityId: doc.id,
    details: { documentNumber: "DOC-001" },
  }).returning();

  fx = {
    orgA:            { id: orgA.id },
    orgB:            { id: orgB.id },
    userA:           { id: userA.id, organizationId: orgA.id },
    userB:           { id: userB.id, organizationId: orgB.id },
    projectA:        { id: projectA.id },
    documentId:      doc.id,
    correspondenceId: corr.id,
    attachmentId:    att.id,
    notificationId:  notif.id,
    auditLogId:      auditLog.id,
    chatGroupId:     chatGroup.id,
    chatMessageId:   chatMsg.id,
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Asserts response is a denial — 403 or 404, NEVER 200 */
function expectDenied(status: number, path: string) {
  expect(
    [403, 404],
    `Expected 403 or 404 for cross-org access to ${path}, got ${status}`,
  ).toContain(status);
  expect(status, `Got 200 on cross-org access to ${path} — TENANT ISOLATION FAILURE`).not.toBe(200);
}

// ─── 1. Projects ──────────────────────────────────────────────────────────────

describe("Projects — cross-org isolation", () => {

  it("Org B admin cannot view Org A's project by ID", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}`);
  });

  it("Org B admin listing projects sees only their own org (empty list, not Org A)", async () => {
    const res = await api()
      .get("/api/projects")
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .expect(200);

    const projects: Array<{ id: number; organizationId: number }> = res.body.projects ?? res.body;
    const orgAProjects = (Array.isArray(projects) ? projects : []).filter(
      (p) => p.organizationId === fx.orgA.id,
    );
    expect(orgAProjects).toHaveLength(0);
  });

  it("Org B admin cannot edit Org A's project", async () => {
    const res = await api()
      .put(`/api/projects/${fx.projectA.id}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ name: "Hacked Project Name" });

    expectDenied(res.status, `PUT /api/projects/${fx.projectA.id}`);
  });

  it("Org B admin cannot delete Org A's project", async () => {
    const res = await api()
      .delete(`/api/projects/${fx.projectA.id}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `DELETE /api/projects/${fx.projectA.id}`);
  });
});

// ─── 2. Documents ─────────────────────────────────────────────────────────────

describe("Documents — cross-org isolation", () => {

  it("Org B admin cannot view a document in Org A's project", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}/documents/${fx.documentId}`);
  });

  it("Org B admin cannot list documents in Org A's project", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}/documents`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}/documents`);
  });

  it("Org B admin cannot upload to Org A's project", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectA.id}/documents`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({
        documentNumber: "EVIL-001",
        title: "Injected Document",
        revision: "A",
      });

    expectDenied(res.status, `POST /api/projects/${fx.projectA.id}/documents`);
  });

  it("Org B admin cannot approve a document in Org A's project", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}/approve`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ comment: "Approved by attacker" });

    expectDenied(res.status, `POST /api/.../documents/${fx.documentId}/approve`);
  });
});

// ─── 3. Correspondence ────────────────────────────────────────────────────────

describe("Correspondence — cross-org isolation", () => {

  it("Org B admin cannot list correspondence in Org A's project", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}/correspondence`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}/correspondence`);
  });

  it("Org B admin cannot view a specific correspondence thread in Org A", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}/correspondence/${fx.correspondenceId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}/correspondence/${fx.correspondenceId}`);
  });

  it("Org B admin cannot reply to Org A's correspondence", async () => {
    const res = await api()
      .post(`/api/projects/${fx.projectA.id}/correspondence/${fx.correspondenceId}/reply`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ body: "Injected reply from attacker" });

    expectDenied(res.status, `POST /api/.../correspondence/${fx.correspondenceId}/reply`);
  });

  // ── Mutation isolation (Sprint A0 security fixes) ──────────────────────────
  // These three tests target the specific endpoints that were missing org checks.
  // Both orgs have correspondence module enabled (set in beforeAll) so the module
  // gate does NOT interfere — a denial here means the org isolation fix is working.

  it("[A-1] Org B admin cannot mark Org A's correspondence as read (PUT /:id/read)", async () => {
    const res = await api()
      .put(`/api/correspondence/${fx.correspondenceId}/read`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ isRead: true });

    // Must be denied. 200 here means the fix is broken — cross-org write succeeded.
    expectDenied(res.status, `PUT /api/correspondence/${fx.correspondenceId}/read`);
  });

  it("[A-2] Org B admin cannot delete Org A's correspondence attachment (DELETE /:id/attachments/:attId)", async () => {
    const res = await api()
      .delete(`/api/correspondence/${fx.correspondenceId}/attachments/${fx.attachmentId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    // Must be denied. 200 here = cross-org deletion succeeded — data destruction.
    expectDenied(res.status, `DELETE /api/correspondence/${fx.correspondenceId}/attachments/${fx.attachmentId}`);
  });

  it("[A-3] Org B admin cannot revoke Org A's correspondence share (DELETE /:id/share)", async () => {
    const res = await api()
      .delete(`/api/correspondence/${fx.correspondenceId}/share`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    // Must be denied. 200 here = cross-org DoS on shared correspondence.
    expectDenied(res.status, `DELETE /api/correspondence/${fx.correspondenceId}/share`);
  });
});

// ─── 4. Notifications ─────────────────────────────────────────────────────────

describe("Notifications — user-scoped isolation", () => {

  it("Org B user listing notifications does NOT see Org A user's notification", async () => {
    const res = await api()
      .get("/api/notifications")
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .expect(200);

    const notifications: Array<{ id: number; userId: number }> =
      res.body.notifications ?? res.body ?? [];

    const leaked = (Array.isArray(notifications) ? notifications : []).filter(
      (n) => n.id === fx.notificationId,
    );
    expect(leaked, "Org A notification leaked to Org B user").toHaveLength(0);
  });

  it("Org B user cannot mark Org A's notification as read", async () => {
    const res = await api()
      .post(`/api/notifications/${fx.notificationId}/read`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    // Should be denied OR not found (the notification doesn't belong to userB)
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(204);
  });

  it("Org B user cannot delete Org A's notification", async () => {
    const res = await api()
      .delete(`/api/notifications/${fx.notificationId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(204);
  });
});

// ─── 5. Search ────────────────────────────────────────────────────────────────

describe("Search — cross-org isolation (CRITICAL)", () => {
  /**
   * Search is the most common place where tenant isolation breaks in SaaS.
   * If organizationId is accidentally omitted from the query, results from
   * all organizations leak through.
   */

  it("Org B user searching for Org A's document title gets no results", async () => {
    const res = await api()
      .get("/api/search?q=Confidential+Engineering+Drawing")
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .expect(200);

    const documents: Array<{ id: number; organizationId?: number }> =
      res.body.documents ?? res.body.results?.documents ?? [];

    const leaked = (Array.isArray(documents) ? documents : []).filter(
      (d) => d.id === fx.documentId,
    );
    expect(
      leaked,
      "CRITICAL: Search leaked Org A document to Org B user",
    ).toHaveLength(0);
  });

  it("Org B user searching for Org A's project name gets no results", async () => {
    const res = await api()
      .get("/api/search?q=Alpha+Secret+Project")
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .expect(200);

    const projects: Array<{ id: number; organizationId?: number }> =
      res.body.projects ?? res.body.results?.projects ?? [];

    const leaked = (Array.isArray(projects) ? projects : []).filter(
      (p) => p.id === fx.projectA.id,
    );
    expect(
      leaked,
      "CRITICAL: Search leaked Org A project to Org B user",
    ).toHaveLength(0);
  });
});

// ─── 6. Audit Logs ────────────────────────────────────────────────────────────

describe("Audit Logs — cross-org isolation", () => {

  it("Org B admin cannot see Org A audit log entries", async () => {
    const res = await api()
      .get("/api/audit-logs")
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .expect(200);

    const logs: Array<{ id: number; organizationId?: number }> =
      res.body.logs ?? res.body ?? [];

    const leaked = (Array.isArray(logs) ? logs : []).filter(
      (l) => l.id === fx.auditLogId || l.organizationId === fx.orgA.id,
    );
    expect(
      leaked,
      "Org A audit log entry leaked to Org B admin",
    ).toHaveLength(0);
  });
});

// ─── 7. Chat — cross-org isolation ───────────────────────────────────────────
//
// Chat is intra-org by design (chatGroupsTable.organizationId NOT NULL).
// These tests guard the role === "admin" bypass that was narrowed in Sprint A-final:
// org-admin must only manage groups within their own organization.
//
// Both orgs have the "chat" module enabled in beforeAll so module-gate 402s
// do not shadow the actual isolation check.

describe("Chat — cross-org isolation (Admin bypass)", () => {

  it("[A-4] Org B admin cannot edit Org A's chat group (PUT /groups/:id)", async () => {
    const res = await api()
      .put(`/api/chat/groups/${fx.chatGroupId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ name: "Hacked Group Name" });

    expectDenied(res.status, `PUT /api/chat/groups/${fx.chatGroupId}`);
  });

  it("[A-5] Org B admin cannot delete Org A's chat group (DELETE /groups/:id)", async () => {
    const res = await api()
      .delete(`/api/chat/groups/${fx.chatGroupId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `DELETE /api/chat/groups/${fx.chatGroupId}`);
  });

  it("[A-6] Org B admin cannot add members to Org A's chat group (POST /groups/:id/members)", async () => {
    const res = await api()
      .post(`/api/chat/groups/${fx.chatGroupId}/members`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"))
      .send({ userIds: [fx.userB.id] });

    expectDenied(res.status, `POST /api/chat/groups/${fx.chatGroupId}/members`);
  });

  it("[A-7] Org B admin cannot remove members from Org A's chat group (DELETE /groups/:id/members/:userId)", async () => {
    const res = await api()
      .delete(`/api/chat/groups/${fx.chatGroupId}/members/${fx.userA.id}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `DELETE /api/chat/groups/${fx.chatGroupId}/members/${fx.userA.id}`);
  });

  it("[A-8] Org B admin cannot delete a message in Org A's chat group (DELETE /groups/:id/messages/:msgId)", async () => {
    const res = await api()
      .delete(`/api/chat/groups/${fx.chatGroupId}/messages/${fx.chatMessageId}`)
      .set(authHeader("admin", fx.userB.id, fx.orgB.id, "admin@beta.test"));

    expectDenied(res.status, `DELETE /api/chat/groups/${fx.chatGroupId}/messages/${fx.chatMessageId}`);
  });
});

// ─── 8. Documents — submit-review reviewer org validation ([A-4-doc]) ────────
//
// submit-review must reject reviewerIds that belong to a different organization.
// Without validation an attacker who knows another org's user ID can create a
// task record assigned to that user — leaking cross-org assignment data.

describe("Documents — submit-review reviewer org validation", () => {

  it("[A-4-doc] Cannot assign a cross-org reviewer when submitting for review", async () => {
    // userA (Org A admin) submits with reviewerIds = [userB.id] (Org B user).
    // The validation must return 422 before updating the document or creating tasks.
    const res = await api()
      .post(`/api/projects/${fx.projectA.id}/documents/${fx.documentId}/submit-review`)
      .set(authHeader("admin", fx.userA.id, fx.orgA.id, "admin@alpha.test"))
      .send({ reviewerIds: [fx.userB.id] });

    // 422 = org validation rejected the cross-org reviewer.
    // Any 2xx means a task was created for a cross-org user — ISOLATION FAILURE.
    expect(
      res.status,
      `Expected 422 for cross-org reviewerId, got ${res.status} — [A-4] reviewer org validation not working`,
    ).toBe(422);
  });
});

// ─── 9. REGRESSION: organizationId from token, not URL param ─────────────────

describe("REGRESSION: org isolation cannot be bypassed via URL manipulation", () => {
  /**
   * This test guards against the specific regression that was fixed in earlier
   * sessions: routes that accepted organizationId from req.query or req.params
   * instead of always reading from req.user.organizationId.
   *
   * An attacker cannot claim a different org by passing ?organizationId=1
   * in the query string.
   */

  it("Org B user cannot bypass isolation by passing Org A's orgId in query string", async () => {
    const res = await api()
      .get(`/api/projects?organizationId=${fx.orgA.id}`)
      .set(authHeader("member", fx.userB.id, fx.orgB.id, "member@beta.test"))
      .expect(200);

    const projects: Array<{ id: number; organizationId: number }> =
      res.body.projects ?? res.body ?? [];

    const leaked = (Array.isArray(projects) ? projects : []).filter(
      (p) => p.organizationId === fx.orgA.id,
    );
    expect(
      leaked,
      "REGRESSION: Org A projects leaked via ?organizationId param manipulation",
    ).toHaveLength(0);
  });

  it("Org B user cannot access Org A project members by providing correct project ID", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectA.id}/members`)
      .set(authHeader("member", fx.userB.id, fx.orgB.id, "member@beta.test"));

    expectDenied(res.status, `/api/projects/${fx.projectA.id}/members`);
  });
});
