/**
 * audit-tx-consistency.test.ts — DEBT-010 Fix A.
 *
 * createAuditLog runs on the `db` proxy, which resolves to the CURRENT tenant tx
 * when one is open. A failed audit INSERT aborts that tx in Postgres; if the
 * error were swallowed, runInTenantTx's COMMIT would silently become a ROLLBACK
 * and the enclosing handler would still return 200 — a false success that
 * discards the whole business operation.
 *
 * Fix A: inside an open tenant tx, createAuditLog PROPAGATES (fails loudly →
 * honest rollback + 500). On the bare pool (no tx to poison) it keeps the
 * best-effort swallow.
 *
 * These tests exercise the library directly (runInTenantTx) — the faithful
 * surface, independent of any one route.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { runInTenantTx, db, organizationsTable, auditLogsTable } from "@workspace/db";
import { createAuditLog } from "../lib/audit.js";
import {
  getTestDb, truncateAllTables, closeTestPool,
  createOrg, createUser, resetFactoryCounters,
} from "./helpers/index.js";

const testDb = getTestDb();

// A project_id that cannot exist → deterministic FK violation on audit_logs.project_id.
const BAD_PROJECT_ID = 999_999_999;

let orgId: number;
let userId: number;

beforeEach(async () => {
  await truncateAllTables();
  resetFactoryCounters();
  const org = await createOrg();
  orgId = org.id;
  await testDb.update(organizationsTable)
    .set({ subscriptionTier: "trial" })
    .where(eq(organizationsTable.id, orgId));
  const u = await createUser({ organizationId: orgId, role: "admin" });
  userId = u.id;
});
afterAll(async () => { await closeTestPool(); });

const validAudit = (extra: Record<string, unknown> = {}) => ({
  userId, organizationId: orgId,
  action: "test_action", entityType: "organization", entityId: orgId,
  ...extra,
});

describe("Fix A — createAuditLog inside a tenant tx cannot produce a false success", () => {
  it("[1] in-tx audit failure REJECTS (the caller sees the failure)", async () => {
    await expect(
      runInTenantTx({ orgId, isSystemOwner: true, userId }, async () => {
        await createAuditLog(validAudit({ projectId: BAD_PROJECT_ID }));
      })
    ).rejects.toThrow();
  });

  it("[2] in-tx audit failure ROLLS BACK the business write (no false-success persistence)", async () => {
    await expect(
      runInTenantTx({ orgId, isSystemOwner: true, userId }, async () => {
        // A real business write BEFORE the audit — must not survive the rollback.
        await db.update(organizationsTable)
          .set({ subscriptionTier: "professional" })
          .where(eq(organizationsTable.id, orgId));
        await createAuditLog(validAudit({ projectId: BAD_PROJECT_ID }));
      })
    ).rejects.toThrow();

    const [o] = await testDb.select({ tier: organizationsTable.subscriptionTier })
      .from(organizationsTable).where(eq(organizationsTable.id, orgId));
    expect(o.tier).toBe("trial"); // rolled back — NOT "professional"

    // …and no audit row was committed either.
    const rows = await testDb.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.organizationId, orgId), eq(auditLogsTable.action, "test_action")));
    expect(rows.length).toBe(0);
  });

  it("[3] OUT of any tx: audit failure stays best-effort (swallowed, resolves, no row)", async () => {
    // No runInTenantTx → no dbContext → runs on the pool → swallow branch.
    await expect(
      createAuditLog(validAudit({ projectId: BAD_PROJECT_ID }))
    ).resolves.toBeUndefined();

    const rows = await testDb.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.organizationId, orgId), eq(auditLogsTable.action, "test_action")));
    expect(rows.length).toBe(0);
  });

  it("[4] in-tx VALID audit still commits (happy path unchanged)", async () => {
    await runInTenantTx({ orgId, isSystemOwner: true, userId }, async () => {
      await db.update(organizationsTable)
        .set({ subscriptionTier: "professional" })
        .where(eq(organizationsTable.id, orgId));
      await createAuditLog(validAudit());
    });

    const [o] = await testDb.select({ tier: organizationsTable.subscriptionTier })
      .from(organizationsTable).where(eq(organizationsTable.id, orgId));
    expect(o.tier).toBe("professional"); // committed

    const rows = await testDb.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.organizationId, orgId), eq(auditLogsTable.action, "test_action")));
    expect(rows.length).toBe(1); // audit committed atomically with the write
  });
});
