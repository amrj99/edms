/**
 * storage-quota.test.ts
 *
 * Integration tests for StorageQuotaService (Sprint C-2).
 *
 * Tests the service directly against the test DB — no HTTP layer needed.
 * The service's internal `db` instance uses DATABASE_URL which setup.ts points
 * to TEST_DATABASE_URL, so all reads/writes go to the test database.
 *
 * ── Scenarios covered ─────────────────────────────────────────────────────────
 *
 *   1. allowed upload       — usage well under quota → allowed: true, level: ok
 *   2. rejected upload      — usage would exceed quota → allowed: false, level: exceeded
 *   3. warning level        — projected usage 80-95% of quota
 *   4. critical level       — projected usage 95-100% of quota
 *   5. exceeded level       — projected usage ≥ 100% of quota
 *   6. increment / decrement consistency — counter returns to baseline after upload+delete
 *   7. Math.ceil symmetry   — sub-MB file: +1 MB on increment, -1 MB on decrement (not 0)
 *   8. quota override       — org_quota_overrides overrides plan default
 *   9. unlimited quota      — override value = -1 → always allowed, quota = null
 *  10. reconcile            — drifted counter is corrected from SUM ground truth
 *
 * ── Strategy ─────────────────────────────────────────────────────────────────
 *
 *   All tests use a per-org override (quotaKey='storage_mb') set to 100 MB for
 *   deterministic numbers, independent of the PLANS constant values.
 *
 *   truncateAllTables() at the top of each describe block + afterAll cleanup.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getTestDb,
  truncateAllTables,
  createOrg,
  createUser,
  createProject,
} from "./helpers/index.js";
import {
  organizationsTable,
  orgQuotaOverridesTable,
  documentFilesTable,
  documentsTable,
} from "@workspace/db";
import {
  StorageQuotaService,
  RESOURCE_POLICIES,
} from "../lib/storage-quota.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Returns a fresh StorageQuotaService instance (same singleton pattern, but isolated). */
function makeService() {
  return new StorageQuotaService();
}

/** Sets org.storage_used_mb directly in the DB. */
async function setOrgUsedMb(orgId: number, mb: number): Promise<void> {
  const db = getTestDb();
  await db
    .update(organizationsTable)
    .set({ storageUsedMb: mb })
    .where(eq(organizationsTable.id, orgId));
}

/** Reads org.storage_used_mb from DB. */
async function getOrgUsedMb(orgId: number): Promise<number> {
  const db = getTestDb();
  const [row] = await db
    .select({ storageUsedMb: organizationsTable.storageUsedMb })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  return row?.storageUsedMb ?? 0;
}

/**
 * Sets a quota override for the org.
 * quotaMb = -1 means unlimited.
 */
async function setQuotaOverride(orgId: number, quotaMb: number): Promise<void> {
  const db = getTestDb();
  await db.insert(orgQuotaOverridesTable).values({
    organizationId: orgId,
    quotaKey:       "storage_mb",
    quotaValue:     quotaMb,
  });
}

const MB  = 1024 * 1024;       // 1 MB in bytes
const KB  = 1024;              // 1 KB in bytes

// ─── Shared fixture ───────────────────────────────────────────────────────────

describe("StorageQuotaService", () => {
  let orgId: number;
  const QUOTA_MB = 100; // override quota for all tests in this suite

  beforeAll(async () => {
    await truncateAllTables();
    const org = await createOrg({ name: "Quota Test Org", code: "QTA001" });
    orgId = org.id;
    // Set a deterministic quota via override (independent of PLANS constant)
    await setQuotaOverride(orgId, QUOTA_MB);
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  // ── 1. Allowed upload ─────────────────────────────────────────────────────

  it("1. allows upload when usage is well under quota", async () => {
    await setOrgUsedMb(orgId, 0);
    const svc = makeService();

    const result = await svc.check(orgId, 10 * MB); // 10 MB request, 0 used, 100 MB quota

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.quota).toBe(QUOTA_MB);
    expect(result.level).toBe("ok");
    expect(result.available).toBe(QUOTA_MB);
    expect(result.policy).toEqual(RESOURCE_POLICIES.storage_mb);
    expect(result.reason).toBeUndefined();
  });

  // ── 2. Rejected upload ───────────────────────────────────────────────────

  it("2. rejects upload when projected usage exceeds quota", async () => {
    await setOrgUsedMb(orgId, 95); // 95 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 10 * MB); // 10 MB request → 95+10=105 MB > 100 MB

    expect(result.allowed).toBe(false);
    expect(result.level).toBe("exceeded");
    expect(result.used).toBe(95);
    expect(result.quota).toBe(QUOTA_MB);
    expect(result.reason).toMatch(/quota exceeded/i);
  });

  // ── 3. Warning level ─────────────────────────────────────────────────────

  it("3. returns warning level when projected usage is 80-95%", async () => {
    await setOrgUsedMb(orgId, 75); // 75 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 10 * MB); // 75+10=85 MB → 85% → warning

    expect(result.allowed).toBe(true);
    expect(result.level).toBe("warning");
  });

  it("3b. returns ok when projected usage is just below 80%", async () => {
    await setOrgUsedMb(orgId, 69); // 69 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 10 * MB); // 69+10=79 MB → 79% → ok

    expect(result.allowed).toBe(true);
    expect(result.level).toBe("ok");
  });

  // ── 4. Critical level ────────────────────────────────────────────────────

  it("4. returns critical level when projected usage is 95-100%", async () => {
    await setOrgUsedMb(orgId, 90); // 90 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 5 * MB); // 90+5=95 MB → 95% → critical

    expect(result.allowed).toBe(true);
    expect(result.level).toBe("critical");
  });

  it("4b. returns critical when projected usage is 99% (just under 100%)", async () => {
    await setOrgUsedMb(orgId, 90); // 90 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 9 * MB); // 90+9=99 MB → 99% → critical

    expect(result.allowed).toBe(true);
    expect(result.level).toBe("critical");
  });

  // ── 5. Exceeded level ────────────────────────────────────────────────────

  it("5. returns exceeded and blocks when projected usage hits 100%", async () => {
    await setOrgUsedMb(orgId, 90); // 90 MB used
    const svc = makeService();

    const result = await svc.check(orgId, 10 * MB); // 90+10=100 MB → 100% → exceeded

    expect(result.allowed).toBe(false);
    expect(result.level).toBe("exceeded");
  });

  it("5b. returns exceeded and blocks when quota is already exceeded", async () => {
    await setOrgUsedMb(orgId, 105); // counter already over quota (drift scenario)
    const svc = makeService();

    const result = await svc.check(orgId, 1 * MB);

    expect(result.allowed).toBe(false);
    expect(result.level).toBe("exceeded");
  });

  // ── 6. Increment / Decrement consistency ─────────────────────────────────

  it("6. counter returns to baseline after upload + delete of same file", async () => {
    await setOrgUsedMb(orgId, 50); // 50 MB baseline
    const svc = makeService();
    const fileBytes = 5 * MB; // 5 MB file

    await svc.increment(orgId, fileBytes);
    expect(await getOrgUsedMb(orgId)).toBe(55); // 50 + ceil(5) = 55

    await svc.decrement(orgId, fileBytes);
    expect(await getOrgUsedMb(orgId)).toBe(50); // back to baseline
  });

  it("6b. counter does not go below 0 on excessive decrement", async () => {
    await setOrgUsedMb(orgId, 2);
    const svc = makeService();

    await svc.decrement(orgId, 10 * MB); // subtract 10 from 2 → GREATEST(0, 2-10) = 0

    expect(await getOrgUsedMb(orgId)).toBe(0);
  });

  // ── 7. Math.ceil symmetry ────────────────────────────────────────────────

  it("7. sub-MB file: increment adds 1 MB, decrement removes 1 MB (not 0)", async () => {
    await setOrgUsedMb(orgId, 10);
    const svc = makeService();

    const subMbFile = 500 * KB; // 500 KB — Math.floor would give 0 (old bug)

    await svc.increment(orgId, subMbFile);
    // Math.ceil(512000 / 1048576) = Math.ceil(0.488...) = 1
    expect(await getOrgUsedMb(orgId)).toBe(11); // 10 + 1

    await svc.decrement(orgId, subMbFile);
    // Math.ceil(512000 / 1048576) = 1 (same formula — symmetric!)
    expect(await getOrgUsedMb(orgId)).toBe(10); // back to 10, not 11 (old Math.floor bug)
  });

  it("7b. 2.5 MB file: increment +3 MB, decrement -3 MB (consistent rounding)", async () => {
    await setOrgUsedMb(orgId, 0);
    const svc = makeService();

    const file = 2.5 * MB; // Math.ceil(2.5) = 3

    await svc.increment(orgId, file);
    expect(await getOrgUsedMb(orgId)).toBe(3);

    await svc.decrement(orgId, file);
    expect(await getOrgUsedMb(orgId)).toBe(0);
  });

  // ── 8. Quota override ────────────────────────────────────────────────────

  describe("8. quota override", () => {
    let overrideOrgId: number;

    beforeAll(async () => {
      const org = await createOrg({ name: "Override Org", code: "QTA002" });
      overrideOrgId = org.id;
    });

    it("8a. org_quota_overrides takes precedence over plan default", async () => {
      const db = getTestDb();
      // Set org to 'starter' plan (50 GB default) but override to 50 MB
      await db.update(organizationsTable)
        .set({ subscriptionTier: "starter" })
        .where(eq(organizationsTable.id, overrideOrgId));

      await setQuotaOverride(overrideOrgId, 50); // 50 MB override

      await setOrgUsedMb(overrideOrgId, 0);
      const svc = makeService();

      // 45 MB upload — fine under 50 MB override, would be fine under 50 GB plan too
      const result45 = await svc.check(overrideOrgId, 45 * MB);
      expect(result45.allowed).toBe(true);
      expect(result45.quota).toBe(50); // override was used, not the 51200 MB plan default

      // 51 MB upload — exceeds 50 MB override (would be fine under 50 GB plan)
      const result51 = await svc.check(overrideOrgId, 51 * MB);
      expect(result51.allowed).toBe(false);
      expect(result51.quota).toBe(50); // confirms override was the limit
    });

    it("8b. expired override falls back to plan default", async () => {
      const db = getTestDb();
      const org2 = await createOrg({ name: "Expired Override Org", code: "QTA003" });
      await db.update(organizationsTable)
        .set({ subscriptionTier: "starter" }) // 51200 MB plan
        .where(eq(organizationsTable.id, org2.id));

      // Insert an EXPIRED override (50 MB, expired yesterday)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.insert(orgQuotaOverridesTable).values({
        organizationId: org2.id,
        quotaKey:       "storage_mb",
        quotaValue:     50,
        expiresAt:      yesterday,
      });

      await setOrgUsedMb(org2.id, 0);
      const svc = makeService();

      // 100 MB upload — would fail if expired override (50 MB) were active
      // Succeeds because expired override is ignored → falls back to starter plan (51200 MB)
      const result = await svc.check(org2.id, 100 * MB);
      expect(result.allowed).toBe(true);
      expect(result.quota).toBe(51200); // starter plan storageMb
    });
  });

  // ── 9. Unlimited quota ───────────────────────────────────────────────────

  describe("9. unlimited quota (override = -1)", () => {
    let unlimitedOrgId: number;

    beforeAll(async () => {
      const org = await createOrg({ name: "Unlimited Org", code: "QTA004" });
      unlimitedOrgId = org.id;
      await setQuotaOverride(unlimitedOrgId, -1); // -1 = unlimited
    });

    it("9a. always allows upload when quota is unlimited", async () => {
      await setOrgUsedMb(unlimitedOrgId, 999999); // absurdly high used
      const svc = makeService();

      const result = await svc.check(unlimitedOrgId, 1000 * MB);

      expect(result.allowed).toBe(true);
      expect(result.quota).toBeNull();
      expect(result.available).toBeNull();
      expect(result.level).toBe("ok");
    });

    it("9b. getStatus returns null quota and ok level for unlimited org", async () => {
      const svc = makeService();
      const status = await svc.getStatus(unlimitedOrgId);

      expect(status.quota).toBeNull();
      expect(status.usedPercent).toBeNull();
      expect(status.level).toBe("ok");
    });
  });

  // ── 10. Reconcile ────────────────────────────────────────────────────────

  describe("10. reconcile", () => {
    let reconcileOrgId: number;

    beforeAll(async () => {
      const org  = await createOrg({ name: "Reconcile Org", code: "QTA005" });
      reconcileOrgId = org.id;
      await setQuotaOverride(reconcileOrgId, 500); // 500 MB quota
    });

    it("10a. reconcile corrects a drifted counter", async () => {
      const db = getTestDb();

      // Set up a project + user + document + files (Tier 2 ground truth)
      const user    = await createUser({ organizationId: reconcileOrgId, role: "admin" });
      const project = await createProject({ organizationId: reconcileOrgId });

      const [doc] = await db.insert(documentsTable).values({
        organizationId: reconcileOrgId,
        projectId:      project.id,
        createdById:    user.id,
        documentNumber: "RECON-001",
        title:          "Reconcile Test Doc",
        revision:       "A",
        status:         "draft",
      }).returning();

      // Insert files totalling exactly 50 MB of actual bytes
      const fileA = 30 * MB; // 30 MB
      const fileB = 20 * MB; // 20 MB
      await db.insert(documentFilesTable).values([
        { documentId: doc.id, fileUrl: "s3://test/a.pdf", fileName: "a.pdf", fileSize: fileA, fileType: "application/pdf", uploadedById: user.id },
        { documentId: doc.id, fileUrl: "s3://test/b.pdf", fileName: "b.pdf", fileSize: fileB, fileType: "application/pdf", uploadedById: user.id },
      ]);

      // Drift: set counter to wrong value (200 MB, but actual SUM = 50 MB)
      await setOrgUsedMb(reconcileOrgId, 200);
      expect(await getOrgUsedMb(reconcileOrgId)).toBe(200); // confirm drift

      const svc = makeService();
      const result = await svc.reconcile(reconcileOrgId, "manual");

      // Ground truth = ceil(50 MB) = 50
      expect(result.counterBefore).toBe(200);
      expect(result.groundTruth).toBe(50);
      expect(result.delta).toBe(-150); // groundTruth - counterBefore
      expect(result.updated).toBe(true);
      expect(result.resourceKey).toBe("storage_mb");

      // Counter should now be corrected
      expect(await getOrgUsedMb(reconcileOrgId)).toBe(50);
    });

    it("10b. reconcile does NOT update when drift is within threshold (≤ 10 MB)", async () => {
      const db = getTestDb();
      const org2 = await createOrg({ name: "Small Drift Org", code: "QTA006" });
      await setQuotaOverride(org2.id, 500);

      // No files → ground truth = 0
      // Set counter to 5 MB (only 5 MB drift, below 10 MB threshold)
      await setOrgUsedMb(org2.id, 5);

      const svc = makeService();
      const result = await svc.reconcile(org2.id, "manual");

      expect(result.updated).toBe(false);
      expect(result.groundTruth).toBe(0);
      expect(result.delta).toBe(-5); // within threshold
      expect(await getOrgUsedMb(org2.id)).toBe(5); // counter unchanged
    });

    it("10c. reconcile with no files returns groundTruth = 0", async () => {
      const org3 = await createOrg({ name: "Empty Org", code: "QTA007" });
      await setOrgUsedMb(org3.id, 0);

      const svc = makeService();
      const result = await svc.reconcile(org3.id, "manual");

      expect(result.groundTruth).toBe(0);
      expect(result.counterBefore).toBe(0);
      expect(result.delta).toBe(0);
      expect(result.updated).toBe(false);
    });
  });

  // ── getStatus ────────────────────────────────────────────────────────────

  it("getStatus returns correct status fields", async () => {
    await setOrgUsedMb(orgId, 82);
    const svc = makeService();

    const status = await svc.getStatus(orgId);

    expect(status.orgId).toBe(orgId);
    expect(status.resourceKey).toBe("storage_mb");
    expect(status.used).toBe(82);
    expect(status.quota).toBe(QUOTA_MB);
    expect(status.usedPercent).toBeCloseTo(0.82);
    expect(status.level).toBe("warning"); // 82% is in warning zone
    expect(status.policy).toEqual(RESOURCE_POLICIES.storage_mb);
  });

  // ── RESOURCE_POLICIES structure ──────────────────────────────────────────

  it("RESOURCE_POLICIES.storage_mb has correct thresholds", () => {
    const policy = RESOURCE_POLICIES.storage_mb!;
    expect(policy.warnAt).toBe(0.80);
    expect(policy.criticalAt).toBe(0.95);
    expect(policy.atLimit).toBe("block");
    expect(policy.renewalCycle).toBe("none");
  });
});
