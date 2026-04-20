/**
 * PlanService — single source of truth for an organisation's subscription plan.
 *
 * ─── getOrgPlan(orgId) — PRODUCTION function (unchanged behavior) ──────────────
 *
 *   Resolution order (Phase 1):
 *     1. subscriptions.plan_id            — PRIMARY SSOT (Stripe-managed)
 *     2. organizations.subscription_tier  — LEGACY FALLBACK (kept for backward
 *                                           compatibility; will be removed in Phase 2)
 *
 *   When the fallback is used, a WARN log is emitted so operators can identify
 *   organisations that have not yet been migrated to the subscriptions table.
 *
 * ─── getResolvedPlan(orgId) — SHADOW function (Phase 2 foundation) ────────────
 *
 *   Shadow-mode: reads the new `plans`, `org_feature_overrides`, and
 *   `org_quota_overrides` tables and returns a rich ResolvedPlan object.
 *   Logs mismatches between the DB-sourced plan and the legacy-sourced plan.
 *
 *   NOT used by any route or middleware yet. Intended for:
 *     - Verifying the plans table is seeded and consistent.
 *     - Logging metrics for fallback and mismatch rates.
 *     - Building the migration path to Phase 3+ enforcement.
 *
 * Usage:
 *   import { getOrgPlan } from "../lib/plan-service.js";          // production
 *   import { getResolvedPlan } from "../lib/plan-service.js";     // shadow
 */

import { db } from "@workspace/db";
import {
  subscriptionsTable, organizationsTable,
  plansTable, orgFeatureOverridesTable, orgQuotaOverridesTable,
} from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── getOrgPlan ───────────────────────────────────────────────────────────────
// PRODUCTION — returns plan ID string. Behavior unchanged from Phase 1.

/**
 * Resolve the active subscription plan ID for an organisation.
 *
 * Returns a plan id string: "free" | "starter" | "basic" | "professional" | "enterprise".
 * Never throws — returns "free" on any unrecoverable error.
 */
export async function getOrgPlan(orgId: number): Promise<string> {
  // ── 1. Primary: subscriptions.plan_id ─────────────────────────────────────
  try {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organizationId, orgId))
      .limit(1);

    if (sub?.planId) {
      return sub.planId;
    }
  } catch (err) {
    logger.error(
      { err, orgId },
      "[plan-service] DB error reading subscriptions table — attempting legacy fallback",
    );
  }

  // ── 2. Legacy fallback: organizations.subscription_tier ──────────────────
  try {
    const [org] = await db
      .select({ subscriptionTier: organizationsTable.subscriptionTier })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    const tier = org?.subscriptionTier ?? "free";

    logger.warn(
      { orgId, fallbackTier: tier },
      "[plan-service] SSOT FALLBACK: no subscriptions row found for org — " +
      "using organizations.subscription_tier. " +
      "Run the subscription backfill script to migrate this org to the subscriptions table.",
    );

    return tier;
  } catch (err) {
    logger.error(
      { err, orgId },
      "[plan-service] DB error reading organizations.subscription_tier — defaulting to 'free'",
    );
    return "free";
  }
}

// ─── ResolvedPlan ─────────────────────────────────────────────────────────────
// Rich plan object returned by getResolvedPlan(). Shadow mode only.

export type PlanSource = "subscriptions" | "org_fallback" | "default_free";

export interface ResolvedPlan {
  /** The plan ID resolved by getOrgPlan() — the current production source */
  planId: string;
  /** How the planId was resolved by getOrgPlan() */
  source: PlanSource;

  // ── Plan definition (from plans table, or null if plan not in DB yet) ──────
  name: string | null;
  priceAed: number | null;
  /** Max users from plan — null = unlimited */
  maxUsers: number | null;
  /** Storage quota from plan in MB */
  storageMb: number | null;
  /** Max files per migration job (-1 = unlimited, 0 = disabled) */
  migrationMaxFiles: number | null;
  /** Rate limit RPM — null = unlimited */
  rateLimitRpm: number | null;

  // ── Per-org overrides (from org_feature_overrides / org_quota_overrides) ───
  featureOverrides: Record<string, boolean>;
  quotaOverrides: Record<string, number>;

  // ── Effective values (plan defaults with overrides applied) ─────────────────
  effectiveMaxUsers: number | null;
  effectiveStorageMb: number | null;
  effectiveMigrationMaxFiles: number | null;
  effectiveRateLimitRpm: number | null;

  // ── Diagnostics ──────────────────────────────────────────────────────────────
  /** true if the plans table has no row for this planId */
  planNotInCatalog: boolean;
  /** true if plan derived from org_feature_overrides has active entries */
  hasFeatureOverrides: boolean;
  /** true if plan derived from org_quota_overrides has active entries */
  hasQuotaOverrides: boolean;
}

// ─── getResolvedPlan ──────────────────────────────────────────────────────────
// SHADOW MODE — not called by any route or middleware yet.
// Reads the new plan catalog tables and logs mismatches.

/**
 * Shadow-mode plan resolver. Returns a rich ResolvedPlan object combining:
 *   - Current production plan ID (from getOrgPlan)
 *   - Plan definition from the plans catalog table
 *   - Per-org feature and quota overrides
 *
 * Logs:
 *   - WARN if plan ID is not in the plans catalog (catalog needs seeding)
 *   - INFO when overrides are active for this org
 *   - INFO on every call with full resolution context (for metrics)
 *
 * Never throws. Returns a safe default plan if anything fails.
 */
export async function getResolvedPlan(orgId: number): Promise<ResolvedPlan> {
  const now = new Date();

  // ── Step 1: Get the current production plan ID (unchanged behavior) ────────
  let planId = "free";
  let source: PlanSource = "default_free";

  try {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organizationId, orgId))
      .limit(1);

    if (sub?.planId) {
      planId = sub.planId;
      source = "subscriptions";
    } else {
      const [org] = await db
        .select({ subscriptionTier: organizationsTable.subscriptionTier })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId))
        .limit(1);
      planId = org?.subscriptionTier ?? "free";
      source = org ? "org_fallback" : "default_free";
    }
  } catch (err) {
    logger.error({ err, orgId }, "[plan-service:shadow] error resolving plan ID — using free");
  }

  // ── Step 2: Look up plan definition in the plans catalog ──────────────────
  let planRow: typeof plansTable.$inferSelect | null = null;
  let planNotInCatalog = false;

  try {
    const [row] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.planId, planId))
      .limit(1);
    planRow = row ?? null;

    if (!planRow) {
      planNotInCatalog = true;
      logger.warn(
        { orgId, planId, source },
        "[plan-service:shadow] plan_not_in_catalog: planId not found in plans table — " +
        "run seedPlans() to populate. Effective limits will be null until seeded.",
      );
    }
  } catch (err) {
    planNotInCatalog = true;
    logger.error({ err, orgId, planId }, "[plan-service:shadow] DB error reading plans table");
  }

  // ── Step 3: Load active per-org feature overrides ─────────────────────────
  const featureOverrides: Record<string, boolean> = {};
  let hasFeatureOverrides = false;

  try {
    const rows = await db
      .select()
      .from(orgFeatureOverridesTable)
      .where(
        and(
          eq(orgFeatureOverridesTable.organizationId, orgId),
          or(
            isNull(orgFeatureOverridesTable.expiresAt),
            gt(orgFeatureOverridesTable.expiresAt, now),
          ),
        ),
      );

    for (const row of rows) {
      featureOverrides[row.featureKey] = row.isEnabled;
    }
    hasFeatureOverrides = rows.length > 0;

    if (hasFeatureOverrides) {
      logger.info(
        { orgId, planId, featureOverrides },
        "[plan-service:shadow] active feature overrides found for org",
      );
    }
  } catch (err) {
    logger.error({ err, orgId }, "[plan-service:shadow] DB error reading org_feature_overrides");
  }

  // ── Step 4: Load active per-org quota overrides ───────────────────────────
  const quotaOverrides: Record<string, number> = {};
  let hasQuotaOverrides = false;

  try {
    const rows = await db
      .select()
      .from(orgQuotaOverridesTable)
      .where(
        and(
          eq(orgQuotaOverridesTable.organizationId, orgId),
          or(
            isNull(orgQuotaOverridesTable.expiresAt),
            gt(orgQuotaOverridesTable.expiresAt, now),
          ),
        ),
      );

    for (const row of rows) {
      quotaOverrides[row.quotaKey] = row.quotaValue;
    }
    hasQuotaOverrides = rows.length > 0;

    if (hasQuotaOverrides) {
      logger.info(
        { orgId, planId, quotaOverrides },
        "[plan-service:shadow] active quota overrides found for org",
      );
    }
  } catch (err) {
    logger.error({ err, orgId }, "[plan-service:shadow] DB error reading org_quota_overrides");
  }

  // ── Step 5: Compute effective values (plan defaults + overrides) ──────────
  const baseMaxUsers          = planRow?.maxUsers          ?? null;
  const baseStorageMb         = planRow?.storageMb         ?? null;
  const baseMigrationMaxFiles = planRow?.migrationMaxFiles ?? null;
  const baseRateLimitRpm      = planRow?.rateLimitRpm      ?? null;

  // Override wins if present; -1 in quota means unlimited → map to null
  const applyQuota = (base: number | null, key: string): number | null => {
    if (!(key in quotaOverrides)) return base;
    const v = quotaOverrides[key];
    return v === -1 ? null : v;
  };

  const effectiveMaxUsers          = applyQuota(baseMaxUsers, "max_users");
  const effectiveStorageMb         = applyQuota(baseStorageMb, "storage_mb");
  const effectiveMigrationMaxFiles = applyQuota(baseMigrationMaxFiles, "migration_max_files");
  const effectiveRateLimitRpm      = applyQuota(baseRateLimitRpm, "rate_limit_rpm");

  // ── Step 6: Emit resolution summary for metrics ───────────────────────────
  logger.info(
    {
      orgId,
      planId,
      source,
      planNotInCatalog,
      hasFeatureOverrides,
      hasQuotaOverrides,
      effective: {
        maxUsers:          effectiveMaxUsers,
        storageMb:         effectiveStorageMb,
        migrationMaxFiles: effectiveMigrationMaxFiles,
        rateLimitRpm:      effectiveRateLimitRpm,
      },
    },
    "[plan-service:shadow] resolved plan",
  );

  return {
    planId,
    source,
    name:               planRow?.name               ?? null,
    priceAed:           planRow?.priceAed            ?? null,
    maxUsers:           baseMaxUsers,
    storageMb:          baseStorageMb,
    migrationMaxFiles:  baseMigrationMaxFiles,
    rateLimitRpm:       baseRateLimitRpm,
    featureOverrides,
    quotaOverrides,
    effectiveMaxUsers,
    effectiveStorageMb,
    effectiveMigrationMaxFiles,
    effectiveRateLimitRpm,
    planNotInCatalog,
    hasFeatureOverrides,
    hasQuotaOverrides,
  };
}
