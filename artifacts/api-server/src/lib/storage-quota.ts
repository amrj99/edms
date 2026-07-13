/**
 * storage-quota.ts
 *
 * Resource Accounting Framework — Sprint C-2 implementation (storage_mb).
 *
 * Architecture principles applied:
 *   P1 Resource Accounting Layer  — ResourceKey type is extensible without redesign
 *   P2 Counter-as-Cache          — Tier 1 counter is fast but derivable from Tier 2 SUM
 *   P3 Provider Agnostic         — service receives bytes + orgId only, no storage details
 *   P4 Full Audit                — 2 audit events: quota_upload_rejected, quota_reconciled
 *   P5 Usage / Quota / Policy    — three distinct concepts; Policy lives in RESOURCE_POLICIES
 *   P6 Accounting ≠ Billing      — reads subscriptions.planId (one field) only; no Stripe calls
 *
 * ── Two-Tier Accounting Model ─────────────────────────────────────────────────
 *
 * Tier 1 (Operational Cache): organizations.storage_used_mb
 *   O(1) read. Updated on every upload/delete.
 *   May drift slightly over time. Corrected by reconcile().
 *
 * Tier 2 (Ground Truth): SUM(document_files.file_size) per org
 *   O(n). Used only by reconcile() to correct Tier 1.
 *   Invariant: Tier 1 can always be fully rebuilt from Tier 2.
 *
 * ── Quota Resolution SSOT ─────────────────────────────────────────────────────
 *
 *   effectiveQuotaMb =
 *     org_quota_overrides WHERE quota_key='storage_mb' AND active  ← per-org
 *     ?? PLANS[planId].storageMb                                   ← plan default
 *     ?? null                                                      ← unlimited
 *
 * ── Rounding convention ───────────────────────────────────────────────────────
 *
 *   Math.ceil for both increment AND decrement — conservative, consistent.
 *   Max drift: 1 MB per file. Corrected by nightly reconcile().
 */

import { db } from "@workspace/db";
import {
  organizationsTable,
  documentFilesTable,
  documentsTable,
  orgQuotaOverridesTable,
} from "@workspace/db";
import { eq, and, or, isNull, gt, sql } from "drizzle-orm";
import { getOrgPlan } from "./plan-service.js";

/** A db handle or an open transaction — anything that can .update() a table. */
type QuotaExecutor = Pick<typeof db, "update">;
import { PLANS } from "./plans.js";
import { createAuditLog } from "./audit.js";

// ─── Resource Framework Types ─────────────────────────────────────────────────

/**
 * P1: Sprint C implements 'storage_mb' only.
 * Add new keys as new resources are implemented — no core redesign required.
 */
export type ResourceKey =
  | "storage_mb"     // Sprint C ← active
  | "ai_credits"     // future
  | "ocr_pages"      // future
  | "email_count"    // future
  | "api_calls_rpm"  // future
  | "project_count"  // future
  | "user_count";    // future

export type QuotaLevel = "ok" | "warning" | "critical" | "exceeded";

/**
 * P5: Policy is defined per-ResourceKey, not per-org.
 * Per-org customisation affects Quota (the number), not Policy (the behaviour).
 */
export interface ResourcePolicy {
  warnAt:       number | null;  // fraction of quota e.g. 0.80; null = no warning
  criticalAt:   number | null;  // fraction of quota e.g. 0.95; null = no critical
  atLimit:      "block" | "allow_overdraft" | "throttle" | "notify_only";
  overdraftCap?: number | null; // only when atLimit = 'allow_overdraft'; null = unlimited
  renewalCycle: "none" | "monthly" | "annual";
}

/**
 * P5: One policy per ResourceKey.
 * Sprint C: only storage_mb is defined.
 */
export const RESOURCE_POLICIES: Partial<Record<ResourceKey, ResourcePolicy>> = {
  storage_mb: {
    warnAt:       0.80,
    criticalAt:   0.95,
    atLimit:      "block",
    renewalCycle: "none",
  },
};

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface QuotaCheckResult {
  allowed:   boolean;
  used:      number;           // MB currently used (before this operation)
  quota:     number | null;    // null = unlimited
  available: number | null;    // null = unlimited
  level:     QuotaLevel;
  policy:    ResourcePolicy;
  reason?:   string;           // populated when !allowed
}

export interface QuotaStatus {
  orgId:       number;
  resourceKey: ResourceKey;
  used:        number;
  quota:       number | null;
  usedPercent: number | null;  // null when quota = null (unlimited)
  level:       QuotaLevel;
  policy:      ResourcePolicy;
}

export interface ReconcileResult {
  orgId:         number;
  resourceKey:   ResourceKey;
  counterBefore: number;
  groundTruth:   number;       // SUM from actual file records, in MB
  delta:         number;       // groundTruth - counterBefore (negative = counter was inflated)
  updated:       boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * P2: Conservative rounding — Math.ceil for both directions.
 * Ensures increment and decrement are symmetric for the same byte count.
 */
function bytesToMb(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / (1024 * 1024));
}

// ─── StorageQuotaService ──────────────────────────────────────────────────────

export class StorageQuotaService {
  private readonly resourceKey: ResourceKey = "storage_mb";
  private readonly policy: ResourcePolicy;

  /** P2: Only update counter if drift exceeds this threshold. */
  private readonly reconcileThresholdMb = 10;

  constructor() {
    const policy = RESOURCE_POLICIES[this.resourceKey];
    if (!policy) throw new Error(`No ResourcePolicy defined for: ${this.resourceKey}`);
    this.policy = policy;
  }

  /**
   * P3: Provider-agnostic pre-upload check.
   * Takes bytes (size of data) — no file path, no provider, no URL.
   *
   * P4: Fires quota_upload_rejected audit event when denied.
   */
  async check(
    orgId: number,
    additionalBytes: number,
    actorId?: number,
  ): Promise<QuotaCheckResult> {
    const deltaMb = bytesToMb(additionalBytes);

    const [org] = await db
      .select({ storageUsedMb: organizationsTable.storageUsedMb })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    const usedMb = org?.storageUsedMb ?? 0;
    const quotaMb = await this._getEffectiveQuotaMb(orgId);

    // Unlimited quota — always allowed, no level calculation needed
    if (quotaMb === null) {
      return {
        allowed:   true,
        used:      usedMb,
        quota:     null,
        available: null,
        level:     "ok",
        policy:    this.policy,
      };
    }

    const projectedMb  = usedMb + deltaMb;
    const usedPercent  = projectedMb / quotaMb;
    const level        = this._computeLevel(usedPercent);
    const available    = Math.max(0, quotaMb - usedMb);
    const blocked      = level === "exceeded" && this.policy.atLimit === "block";

    if (blocked) {
      // P4: Audit rejected upload
      await createAuditLog({
        userId:         actorId,
        organizationId: orgId,
        action:         "quota_upload_rejected",
        entityType:     "organization",
        entityId:       orgId,
        details: {
          resourceType: this.resourceKey,
          requestedMb:  deltaMb,
          usedMb,
          quotaMb,
          level,
        },
      });

      return {
        allowed:   false,
        used:      usedMb,
        quota:     quotaMb,
        available,
        level,
        policy:    this.policy,
        reason:    `Storage quota exceeded. Used ${usedMb} MB of ${quotaMb} MB.`,
      };
    }

    return {
      allowed:   true,
      used:      usedMb,
      quota:     quotaMb,
      available,
      level,
      policy:    this.policy,
    };
  }

  /**
   * Increment counter after a confirmed successful upload.
   * P2: Math.ceil — same formula as decrement (fixes the old Math.floor asymmetry).
   * P3: Takes bytes — no storage provider details.
   */
  async increment(orgId: number, bytes: number, exec: QuotaExecutor = db): Promise<void> {
    const deltaMb = bytesToMb(bytes);
    if (deltaMb === 0) return;

    // B2.3a: accepts an optional transaction handle so the counter update
    // commits atomically with the document_files rows it accounts for. When
    // omitted it uses the global db (unchanged for all existing callers).
    await exec
      .update(organizationsTable)
      .set({
        storageUsedMb: sql`GREATEST(0, COALESCE(storage_used_mb, 0) + ${deltaMb})`,
        updatedAt:     new Date(),
      })
      .where(eq(organizationsTable.id, orgId));
  }

  /**
   * Decrement counter after a confirmed successful delete.
   * P2: Math.ceil — same formula as increment (symmetric).
   */
  async decrement(orgId: number, bytes: number): Promise<void> {
    const deltaMb = bytesToMb(bytes);
    if (deltaMb === 0) return;

    await db
      .update(organizationsTable)
      .set({
        storageUsedMb: sql`GREATEST(0, COALESCE(storage_used_mb, 0) - ${deltaMb})`,
        updatedAt:     new Date(),
      })
      .where(eq(organizationsTable.id, orgId));
  }

  /**
   * Current quota status — for Dashboard display and response headers.
   */
  async getStatus(orgId: number): Promise<QuotaStatus> {
    const [org] = await db
      .select({ storageUsedMb: organizationsTable.storageUsedMb })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    const usedMb  = org?.storageUsedMb ?? 0;
    const quotaMb = await this._getEffectiveQuotaMb(orgId);

    const usedPercent = quotaMb !== null ? usedMb / quotaMb : null;
    const level       = usedPercent !== null ? this._computeLevel(usedPercent) : "ok";

    return {
      orgId,
      resourceKey: this.resourceKey,
      used:        usedMb,
      quota:       quotaMb,
      usedPercent,
      level,
      policy:      this.policy,
    };
  }

  /**
   * P2: Reconcile Tier 1 counter against Tier 2 Ground Truth.
   * Corrects drift from rounding, failed rollbacks, or orphaned files.
   *
   * P4: Fires quota_reconciled audit event when counter is updated.
   *
   * Only updates if |delta| > reconcileThresholdMb to avoid noisy updates
   * from expected per-file rounding.
   */
  async reconcile(
    orgId: number,
    trigger: "nightly_job" | "manual",
  ): Promise<ReconcileResult> {
    const [org] = await db
      .select({ storageUsedMb: organizationsTable.storageUsedMb })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    const counterBefore = org?.storageUsedMb ?? 0;

    // Tier 2: Ground Truth — SUM from actual file records
    const [sumRow] = await db
      .select({
        totalBytes: sql<string>`COALESCE(SUM(${documentFilesTable.fileSize}), 0)`,
      })
      .from(documentFilesTable)
      .innerJoin(documentsTable, eq(documentFilesTable.documentId, documentsTable.id))
      .where(eq(documentsTable.organizationId, orgId));

    const totalBytes  = Number(sumRow?.totalBytes ?? 0);
    const groundTruth = bytesToMb(totalBytes);
    const delta       = groundTruth - counterBefore;
    const updated     = Math.abs(delta) > this.reconcileThresholdMb;

    if (updated) {
      await db
        .update(organizationsTable)
        .set({ storageUsedMb: groundTruth, updatedAt: new Date() })
        .where(eq(organizationsTable.id, orgId));

      // P4: Audit the correction
      await createAuditLog({
        organizationId: orgId,
        action:         "quota_reconciled",
        entityType:     "organization",
        entityId:       orgId,
        beforeState:    { storage_used_mb: counterBefore },
        afterState:     { storage_used_mb: groundTruth },
        details: {
          resourceType: this.resourceKey,
          delta,
          trigger,
        },
      });
    }

    return { orgId, resourceKey: this.resourceKey, counterBefore, groundTruth, delta, updated };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve effective quota for org.
   *
   * P6: Reads only planId from the billing domain (subscriptions table via getOrgPlan).
   *     No other billing state (Stripe IDs, payment status, invoice) is accessed.
   *
   * Resolution order:
   *   1. org_quota_overrides WHERE quota_key='storage_mb' AND (active or non-expiring)
   *      quotaValue = -1 → unlimited (null)
   *   2. PLANS[planId].storageMb — plan default
   *   3. null — unlimited (plan unknown)
   */
  private async _getEffectiveQuotaMb(orgId: number): Promise<number | null> {
    const now = new Date();

    const [override] = await db
      .select({ quotaValue: orgQuotaOverridesTable.quotaValue })
      .from(orgQuotaOverridesTable)
      .where(
        and(
          eq(orgQuotaOverridesTable.organizationId, orgId),
          eq(orgQuotaOverridesTable.quotaKey, "storage_mb"),
          or(
            isNull(orgQuotaOverridesTable.expiresAt),
            gt(orgQuotaOverridesTable.expiresAt, now),
          ),
        ),
      )
      .limit(1);

    if (override !== undefined) {
      // -1 is the convention for unlimited in org_quota_overrides
      return override.quotaValue === -1 ? null : override.quotaValue;
    }

    // P6: reads planId only from billing domain
    const planId = await getOrgPlan(orgId);
    const plan   = PLANS.find(p => p.id === planId);
    return plan?.storageMb ?? null;
  }

  /** Translate usedPercent (projected, post-upload) to QuotaLevel via policy thresholds. */
  private _computeLevel(usedPercent: number): QuotaLevel {
    if (usedPercent >= 1.0)                                                        return "exceeded";
    if (this.policy.criticalAt !== null && usedPercent >= this.policy.criticalAt) return "critical";
    if (this.policy.warnAt     !== null && usedPercent >= this.policy.warnAt)     return "warning";
    return "ok";
  }
}

/** Singleton instance for use in routes. */
export const storageQuota = new StorageQuotaService();
