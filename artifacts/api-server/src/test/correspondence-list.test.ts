/**
 * correspondence-list.test.ts
 *
 * Integration tests for GET /api/projects/:projectId/correspondence
 *
 * Validates B-3 changes:
 *   [B-3-1] Column projection in enrichCorrespondence — response shape unchanged,
 *           sensitive user columns (passwordHash, etc.) not leaked.
 *   [B-3-2] SQL-level filtering for folder/type/scope — correct items returned
 *           without loading all records into JS memory first.
 *
 * Also verifies that tenant isolation still holds after the refactor.
 *
 * ── Route under test ─────────────────────────────────────────────────────────
 *   GET /api/projects/:projectId/correspondence?folder=&type=&scope=&viewAll=true
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
  correspondenceTable,
  correspondenceRecipientsTable,
  correspondenceCcTable,
  correspondenceAttachmentsTable,
  orgConfigTable,
  projectMembersTable,
} from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixtures {
  orgId:      number;
  orgBId:     number;
  userId:     number;
  userBId:    number;
  projectId:  number;
  corrIds: {
    draft_letter:   number;
    sent_memo:      number;
    sent_letter:    number;   // same type as draft_letter, different folder
    internal_sent:  number;   // scope = internal
  };
  recipientUserId: number;
  ccUserId:        number;
  attachmentId:    number;
}

let fx: Fixtures;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();

  const org  = await createOrg({ name: "CorrListOrg", code: "CLIST" });
  const orgB = await createOrg({ name: "CorrListOrgB", code: "CLISTB" });

  const user      = await createUser({ organizationId: org.id,  role: "admin",  email: "corr-admin@test.edms" });
  const recipient = await createUser({ organizationId: org.id,  role: "member", email: "corr-recipient@test.edms" });
  const cc        = await createUser({ organizationId: org.id,  role: "member", email: "corr-cc@test.edms" });
  const userB     = await createUser({ organizationId: orgB.id, role: "admin",  email: "corr-attacker@test.edms" });

  const project = await createProject({ organizationId: org.id, name: "Corr Project", code: "CORR-001" });

  // Enable correspondence module for both orgs
  await db.insert(orgConfigTable).values([
    { organizationId: org.id,  modules: { correspondence: true, dashboard: true, deliverables: true, registers: true, notifications: true } },
    { organizationId: orgB.id, modules: { correspondence: true, dashboard: true, deliverables: true, registers: true, notifications: true } },
  ]);

  await db.insert(projectMembersTable).values({ projectId: project.id, userId: user.id, role: "admin" });

  // Seed 4 correspondence items with varied attributes
  const [draftLetter] = await db.insert(correspondenceTable).values({
    organizationId: org.id,
    projectId: project.id,
    subject: "Draft Letter Subject",
    type: "letter",
    body: "body",
    fromUserId: user.id,
    folder: "draft",
    status: "draft",
    scope: "project",
    referenceNumber: "REF-001",
  }).returning();

  const [sentMemo] = await db.insert(correspondenceTable).values({
    organizationId: org.id,
    projectId: project.id,
    subject: "Sent Memo Subject",
    type: "memo",
    body: "body",
    fromUserId: user.id,
    folder: "sent",
    status: "sent",
    scope: "project",
    referenceNumber: "REF-002",
  }).returning();

  const [sentLetter] = await db.insert(correspondenceTable).values({
    organizationId: org.id,
    projectId: project.id,
    subject: "Sent Letter Subject",
    type: "letter",
    body: "body",
    fromUserId: user.id,
    folder: "sent",
    status: "sent",
    scope: "project",
    referenceNumber: "REF-003",
  }).returning();

  const [internalSent] = await db.insert(correspondenceTable).values({
    organizationId: org.id,
    projectId: project.id,
    subject: "Internal Notice",
    type: "memo",
    body: "body",
    fromUserId: user.id,
    folder: "sent",
    status: "sent",
    scope: "internal",
    referenceNumber: "REF-004",
  }).returning();

  // Add recipient and CC to sentMemo (for enrichment tests)
  await db.insert(correspondenceRecipientsTable).values({
    correspondenceId: sentMemo.id,
    userId: recipient.id,
  });
  await db.insert(correspondenceCcTable).values({
    correspondenceId: sentMemo.id,
    userId: cc.id,
  });

  // Add attachment to sentMemo
  const [att] = await db.insert(correspondenceAttachmentsTable).values({
    correspondenceId: sentMemo.id,
    fileName: "report.pdf",
    fileUrl: "https://storage.example.com/report.pdf",
    fileSize: 204800,
  }).returning();

  fx = {
    orgId:      org.id,
    orgBId:     orgB.id,
    userId:     user.id,
    userBId:    userB.id,
    projectId:  project.id,
    corrIds: {
      draft_letter:  draftLetter.id,
      sent_memo:     sentMemo.id,
      sent_letter:   sentLetter.id,
      internal_sent: internalSent.id,
    },
    recipientUserId: recipient.id,
    ccUserId:        cc.id,
    attachmentId:    att.id,
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── [B-3-1] Enrichment response shape ────────────────────────────────────────

describe("[B-3-1] enrichCorrespondence — response shape", () => {

  it("GET / returns items with all expected enrichment fields", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);

    const item = res.body.items[0];
    // Core correspondence fields
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("subject");
    expect(item).toHaveProperty("type");
    expect(item).toHaveProperty("folder");
    expect(item).toHaveProperty("status");
    expect(item).toHaveProperty("scope");
    // Enrichment fields
    expect(item).toHaveProperty("fromUserName");
    expect(item).toHaveProperty("fromUserEmail");
    expect(item).toHaveProperty("toUserIds");
    expect(item).toHaveProperty("toUserNames");
    expect(item).toHaveProperty("toUserEmails");
    expect(item).toHaveProperty("ccUserIds");
    expect(item).toHaveProperty("ccUserNames");
    expect(item).toHaveProperty("ccUserEmails");
    expect(item).toHaveProperty("attachments");
  });

  it("enriched item does NOT expose passwordHash or sensitive user columns", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("refreshToken");
    expect(body).not.toContain("resetToken");
    expect(body).not.toContain("passwordResetToken");
  });

  it("recipients (toUserIds/Names/Emails) are correctly populated", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    const memo = res.body.items.find((i: { id: number }) => i.id === fx.corrIds.sent_memo);
    expect(memo).toBeDefined();
    expect(memo.toUserIds).toContain(fx.recipientUserId);
    expect(memo.toUserNames.length).toBe(1);
    expect(memo.toUserEmails.length).toBe(1);
    expect(typeof memo.toUserEmails[0]).toBe("string");
    expect(memo.toUserEmails[0]).toContain("@");
  });

  it("CC users (ccUserIds/Names/Emails) are correctly populated", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    const memo = res.body.items.find((i: { id: number }) => i.id === fx.corrIds.sent_memo);
    expect(memo).toBeDefined();
    expect(memo.ccUserIds).toContain(fx.ccUserId);
    expect(memo.ccUserNames.length).toBe(1);
    expect(memo.ccUserEmails.length).toBe(1);
    expect(memo.ccUserEmails[0]).toContain("@");
  });

  it("attachments array is correctly populated with expected fields", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    const memo = res.body.items.find((i: { id: number }) => i.id === fx.corrIds.sent_memo);
    expect(memo).toBeDefined();
    expect(memo.attachments).toHaveLength(1);

    const att = memo.attachments[0];
    expect(att).toHaveProperty("id", fx.attachmentId);
    expect(att).toHaveProperty("fileName", "report.pdf");
    expect(att).toHaveProperty("fileUrl");
    expect(att).toHaveProperty("fileSize", 204800);
    expect(att).toHaveProperty("uploadedAt");
    // correspondenceId must NOT be leaked in the attachment shape
    // (it's internal and excluded by the .map() in enrichCorrespondence)
    expect(att).not.toHaveProperty("correspondenceId");
  });

  it("items with no recipients return empty arrays (not undefined)", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    const letter = res.body.items.find((i: { id: number }) => i.id === fx.corrIds.draft_letter);
    expect(letter).toBeDefined();
    expect(letter.toUserIds).toEqual([]);
    expect(letter.toUserNames).toEqual([]);
    expect(letter.toUserEmails).toEqual([]);
    expect(letter.ccUserIds).toEqual([]);
    expect(letter.attachments).toEqual([]);
  });
});

// ─── [B-3-2] SQL-level filters ────────────────────────────────────────────────

describe("[B-3-2] GET / — SQL filter params (folder, type, scope)", () => {

  it("?folder=draft returns only draft items", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&folder=draft`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(item.folder).toBe("draft");
    }
    // draft_letter is the only draft
    const ids = res.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(fx.corrIds.draft_letter);
    expect(ids).not.toContain(fx.corrIds.sent_memo);
    expect(ids).not.toContain(fx.corrIds.sent_letter);
  });

  it("?type=memo returns only memo items", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&type=memo`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(item.type).toBe("memo");
    }
    const ids = res.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(fx.corrIds.sent_memo);
    expect(ids).toContain(fx.corrIds.internal_sent);
    expect(ids).not.toContain(fx.corrIds.draft_letter);
    expect(ids).not.toContain(fx.corrIds.sent_letter);
  });

  it("?type=letter returns only letter items", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&type=letter`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.type).toBe("letter");
    }
    const ids = res.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(fx.corrIds.draft_letter);
    expect(ids).toContain(fx.corrIds.sent_letter);
    expect(ids).not.toContain(fx.corrIds.sent_memo);
  });

  it("?scope=internal returns only internal-scope items", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&scope=internal`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.scope).toBe("internal");
    }
    const ids = res.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(fx.corrIds.internal_sent);
    expect(ids).not.toContain(fx.corrIds.sent_memo);
  });

  it("?folder=sent&type=letter returns only sent letters", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&folder=sent&type=letter`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.folder).toBe("sent");
      expect(item.type).toBe("letter");
    }
    const ids = res.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(fx.corrIds.sent_letter);
    // draft_letter is draft → excluded
    expect(ids).not.toContain(fx.corrIds.draft_letter);
    // sent_memo is not a letter → excluded
    expect(ids).not.toContain(fx.corrIds.sent_memo);
  });

  it("no filter params returns all items", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  it("filter that matches nothing returns empty items array", async () => {
    // Use a valid enum type ('rfi') for which no correspondence was seeded
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true&type=rfi`)
      .set(authHeader("admin", fx.userId, fx.orgId, "corr-admin@test.edms"));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ─── Tenant Isolation (regression guard) ──────────────────────────────────────

describe("Tenant Isolation — after B-3 refactor", () => {

  it("Org B admin cannot list Org A's correspondence", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence?viewAll=true`)
      .set(authHeader("admin", fx.userBId, fx.orgBId, "corr-attacker@test.edms"));

    expect(
      [403, 404],
      `Expected 403/404 for cross-org correspondence list, got ${res.status}`,
    ).toContain(res.status);
  });

  it("Org B admin cannot view a specific Org A correspondence item", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/correspondence/${fx.corrIds.sent_memo}`)
      .set(authHeader("admin", fx.userBId, fx.orgBId, "corr-attacker@test.edms"));

    expect(
      [403, 404],
      `Expected 403/404 for cross-org correspondence GET /:id, got ${res.status}`,
    ).toContain(res.status);
  });
});
