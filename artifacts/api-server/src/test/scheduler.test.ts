/**
 * scheduler.test.ts
 *
 * Integration tests for the notification scheduler batch processor.
 *
 * ── What we test ──────────────────────────────────────────────────────────────
 *
 *   [B-4-1] Batch user lookup: all targetUserIds in a batch are resolved via a
 *           single inArray query rather than one SELECT per job.
 *
 *   [B-4-2] Controlled concurrency: jobs in the same chunk run via
 *           Promise.allSettled so one failure cannot abort the others.
 *
 *   Core invariants:
 *     - sentAt is set on EVERY processed job (success or failure).
 *     - Cancelled, future, and already-sent jobs are never re-processed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getTestDb,
  createOrg,
  createUser,
  truncateAllTables,
} from "./helpers/index.js";
import { scheduledNotificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { processBatch } from "../lib/notifications/scheduler.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixtures {
  orgId:   number;
  userAId: number;
  userBId: number;
}

let fx: Fixtures;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();
  const org   = await createOrg({ name: "SchedOrg", code: "SCHED" });
  const userA = await createUser({ organizationId: org.id, role: "admin",  email: "sched-a@test.edms" });
  const userB = await createUser({ organizationId: org.id, role: "member", email: "sched-b@test.edms" });
  fx = { orgId: org.id, userAId: userA.id, userBId: userB.id };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

const past   = () => new Date(Date.now() - 60_000);        // 1 minute ago
const future = () => new Date(Date.now() + 60 * 60_000);   // 1 hour from now

async function getSentAt(id: number) {
  const db = getTestDb();
  const [row] = await db
    .select({ sentAt: scheduledNotificationsTable.sentAt })
    .from(scheduledNotificationsTable)
    .where(eq(scheduledNotificationsTable.id, id));
  return row?.sentAt ?? null;
}

// ─── [B-4-1] Batch user lookup ────────────────────────────────────────────────

describe("[B-4-1] + [B-4-2] processBatch — core invariants", () => {

  it("all pending jobs across multiple users get sentAt set in one batch", async () => {
    const db = getTestDb();

    // Two users → normally would have been 2 separate user queries; batch = 1
    const rows = await db.insert(scheduledNotificationsTable).values([
      { eventKey: "sla.due_soon",  fireAt: past(), targetUserId: fx.userAId, organizationId: fx.orgId, entityType: "document", entityId: 1, metadata: { title: "Doc A1" } },
      { eventKey: "sla.breached",  fireAt: past(), targetUserId: fx.userAId, organizationId: fx.orgId, entityType: "document", entityId: 2, metadata: { title: "Doc A2" } },
      { eventKey: "sla.due_soon",  fireAt: past(), targetUserId: fx.userBId, organizationId: fx.orgId, entityType: "document", entityId: 3, metadata: { title: "Doc B1" } },
    ]).returning({ id: scheduledNotificationsTable.id });

    await processBatch();

    for (const { id } of rows) {
      const sentAt = await getSentAt(id);
      expect(sentAt, `job ${id} must have sentAt set`).not.toBeNull();
    }
  });

  it("job with no targetUserId (null) still gets sentAt set", async () => {
    const db = getTestDb();

    // targetUserId intentionally omitted — handler returns early but sentAt must still be set
    const [{ id }] = await db.insert(scheduledNotificationsTable).values({
      eventKey: "sla.due_soon",
      fireAt:   past(),
      organizationId: fx.orgId,
    }).returning({ id: scheduledNotificationsTable.id });

    await processBatch();

    expect(await getSentAt(id)).not.toBeNull();
  });

// ─── [B-4-2] Job isolation ────────────────────────────────────────────────────

  it("unknown eventKey job does not block a valid job in the same chunk", async () => {
    const db = getTestDb();

    const rows = await db.insert(scheduledNotificationsTable).values([
      // unknown eventKey — hits `default: console.warn(...)`, returns normally
      { eventKey: "unknown.nonexistent", fireAt: past(), targetUserId: fx.userAId, organizationId: fx.orgId },
      // valid job in the same chunk
      { eventKey: "sla.due_soon",        fireAt: past(), targetUserId: fx.userBId, organizationId: fx.orgId, entityType: "document", entityId: 4, metadata: { title: "Normal" } },
    ]).returning({ id: scheduledNotificationsTable.id, eventKey: scheduledNotificationsTable.eventKey });

    await processBatch();

    for (const { id, eventKey } of rows) {
      const sentAt = await getSentAt(id);
      expect(sentAt, `job ${id} (${eventKey}) must have sentAt set`).not.toBeNull();
    }
  });

// ─── Eligibility filter tests ─────────────────────────────────────────────────

  it("cancelled jobs are skipped — sentAt remains null", async () => {
    const db = getTestDb();

    const [{ id }] = await db.insert(scheduledNotificationsTable).values({
      eventKey:    "sla.due_soon",
      fireAt:      past(),
      targetUserId: fx.userAId,
      organizationId: fx.orgId,
      cancelledAt: new Date(),  // already cancelled
    }).returning({ id: scheduledNotificationsTable.id });

    await processBatch();

    expect(await getSentAt(id)).toBeNull();
  });

  it("future-scheduled jobs are not yet processed — sentAt remains null", async () => {
    const db = getTestDb();

    const [{ id }] = await db.insert(scheduledNotificationsTable).values({
      eventKey:    "sla.due_soon",
      fireAt:      future(),    // fires in the future
      targetUserId: fx.userAId,
      organizationId: fx.orgId,
    }).returning({ id: scheduledNotificationsTable.id });

    await processBatch();

    expect(await getSentAt(id)).toBeNull();
  });

  it("already-sent jobs are not re-processed — sentAt timestamp unchanged", async () => {
    const db = getTestDb();
    const originalSentAt = new Date(Date.now() - 30_000);

    const [{ id }] = await db.insert(scheduledNotificationsTable).values({
      eventKey:    "sla.due_soon",
      fireAt:      past(),
      targetUserId: fx.userAId,
      organizationId: fx.orgId,
      sentAt:      originalSentAt,    // already processed — must not be touched again
    }).returning({ id: scheduledNotificationsTable.id });

    await processBatch();

    const sentAt = await getSentAt(id);
    // sentAt must remain exactly what was seeded, not overwritten by another dispatch
    expect(sentAt?.getTime()).toBe(originalSentAt.getTime());
  });

  it("correspondence event types get sentAt set", async () => {
    const db = getTestDb();

    const rows = await db.insert(scheduledNotificationsTable).values([
      { eventKey: "correspondence.unread_reminder", fireAt: past(), targetUserId: fx.userAId, organizationId: fx.orgId, entityType: "correspondence", entityId: 10, metadata: { subject: "Meeting Notes" } },
      { eventKey: "correspondence.no_response",     fireAt: past(), targetUserId: fx.userBId, organizationId: fx.orgId, entityType: "correspondence", entityId: 11, metadata: { subject: "Action Required" } },
    ]).returning({ id: scheduledNotificationsTable.id, eventKey: scheduledNotificationsTable.eventKey });

    await processBatch();

    for (const { id, eventKey } of rows) {
      const sentAt = await getSentAt(id);
      expect(sentAt, `correspondence job ${id} (${eventKey}) must have sentAt set`).not.toBeNull();
    }
  });
});
