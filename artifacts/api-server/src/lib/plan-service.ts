/**
 * PlanService — single source of truth for an organisation's subscription plan.
 *
 * ─── getOrgPlan(orgId) — PRODUCTION function (behavior unchanged) ────────────
 *
 *   Resolution order (Phase 1):
 *     1. subscriptions.plan_id            — PRIMARY SSOT (Stripe-managed)
 *     2. organizations.subscription_tier  — LEGACY FALLBACK
 *
 *   Never throws. Returns "free" on any unrecoverable error.
 *
 * ─── getResolvedPlan(orgId) — SHADOW function (Phase 2.5) ───────────────────
 *
 *   Reads the plans catalog + org overrides + org_config.modules and:
 *     - Emits plan.config.features and plan.config.quotas at INFO
 *     - Compares org_config.modules  vs getDefaultModulesForPlan(planId) → mismatch WARN
 *     - Compares legacy TIER_RPM     vs plans.rate_limit_rpm              → mismatch WARN
 *     - Compares legacy PLAN_LIMITS  vs plans.migration_max_files         → mismatch WARN
 *
 *   NOT used by any route or middleware for enforcement yet.
 *   Called fire-and-forget from shadowPlanMiddleware (see shadow-plan-middleware.ts).
 *
 * ─── LEGACY VALUES for mismatch comparison ───────────────────────────────────
 *
 *   These are copied from:
 *     - TIER_RPM   in middlewares/tenant-rate-limit.ts
 *     - PLAN_LIMITS in routes/migrations.ts
 *
 *   They are NOT used for enforcement here — comparison only.
 *   When Phase 3 switches to catalog-driven enforcement, these can be removed.
 */

import { db } from "@workspace/db";
import {
  subscriptionsTable, organizationsTable,
  plansTable, orgFeatureOverridesTable, orgQuotaOverridesTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { logger } from "./logger.js";
import { getDefaultModulesForPlan } from "./plans.js";
import { normalizePlanId } from "./plan-normalizer.js";

// ─── Legacy limit maps (shadow comparison only — do NOT use for enforcement) ──

/** Mirrors TIER_RPM in middlewares/tenant-rate-limit.ts */
const LEGACY_TIER_RPM: Record<string, number | null> = {
  free:         300,   // Phase A alias — same as expired
  expired:      300,
  starter:      400,
  basic:        600,
  professional: 1500,
  enterprise:   null,
};

/** Mirrors PLAN_LIMITS in routes/migrations.ts (-1 = Infinity in the legacy map) */
const LEGACY_PLAN_LIMITS: Record<string, number> = {
  free:         0,     // Phase A alias — same as expired
  expired:      0,
  starter:      0,
  basic:        200,
  professional: 1000,
  enterprise:   -1,   // Infinity in migrations.ts
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PlanSource = "subscriptions" | "org_fallback" | "default_free";

/** Named quota limits resolved for this org (effective = plan default + overrides). */
export interface PlanQuotas {
  maxUsers:           number | null;   // null = unlimited
  storageMb:          number | null;
  migrationMaxFiles:  number | null;   // 0 = wizard disabled, -1 = unlimited
  rateLimitRpm:       number | null;   // null = unlimited
}

/** One module whose org_config value differs from the plan's expected default. */
export interface ModuleMismatch {
  module:      string;
  orgValue:    boolean;   // what org_config.modules currently has
  planDefault: boolean;   // what getDefaultModulesForPlan(planId) says it should be
}

/** One quota where the legacy hardcoded value differs from the plans catalog. */
export interface QuotaMismatch {
  quota:        string;
  legacyValue:  number | null;  // value in TIER_RPM / PLAN_LIMITS
  catalogValue: number | null;  // value in plans table
}

export interface MismatchReport {
  modules:       ModuleMismatch[];
  quotas:        QuotaMismatch[];
  hasMismatches: boolean;
}

export interface ResolvedPlan {
  // ── Plan identity ────────────────────────────────────────────────────────────
  planId:  string;
  source:  PlanSource;
  name:    string | null;
  priceAed: number | null;

  // ── Plan features (marketing copy from plans catalog) ────────────────────────
  config: {
    features: string[];   // e.g. ["Up to 25 users", "25 GB storage", …]
    quotas:   PlanQuotas; // effective (plan default + org overrides applied)
  };

  // ── Raw plan defaults (before overrides) ─────────────────────────────────────
  maxUsers:           number | null;
  storageMb:          number | null;
  migrationMaxFiles:  number | null;
  rateLimitRpm:       number | null;

  // ── Per-org overrides ────────────────────────────────────────────────────────
  featureOverrides: Record<string, boolean>;
  quotaOverrides:   Record<string, number>;

  // ── Effective values (plan defaults with org overrides applied) ───────────────
  effectiveMaxUsers:           number | null;
  effectiveStorageMb:          number | null;
  effectiveMigrationMaxFiles:  number | null;
  effectiveRateLimitRpm:       number | null;

  // ── Mismatch report (shadow comparison, never enforced) ──────────────────────
  mismatch: MismatchReport;

  // ── Diagnostics ──────────────────────────────────────────────────────────────
  planNotInCatalog:   boolean;
  hasFeatureOverrides: boolean;
  hasQuotaOverrides:   boolean;
}

// ─── getOrgPlan ───────────────────────────────────────────────────────────────
// PRODUCTION — returns plan ID string. Behavior unchanged from Phase 1.

/**
 * Resolve the active subscription plan ID for an organisation.
 * Returns "free" | "starter" | "basic" | "professional" | "enterprise".
 * Never throws — returns "free" on any unrecoverable error.
 */
export async function getOrgPlan(orgId: number): Promise<string> {
  // 1. Primary: subscriptions.plan_id
  try {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organizationId, orgId))
      .limit(1);

    if (sub?.planId) return sub.planId;
  } catch (err) {
    logger.error(
      { err, orgId },
      "[plan-service] DB error reading subscriptions — attempting legacy fallback",
    );
  }

  // 2. Legacy fallback: organizations.subscription_tier
  try {
    const [org] = await db
      .select({ subscriptionTier: organizationsTable.subscriptionTier })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    const tier = normalizePlanId(org?.subscriptionTier);
    logger.warn(
      { orgId, fallbackTier: tier },
      "[plan-service] SSOT FALLBACK: no subscriptions row — using organizations.subscription_tier",
    );
    return tier;
  } catch (err) {
    logger.error(
      { err, orgId },
      "[plan-service] DB error reading subscription_tier — defaulting to 'expired'",
    );
    return "expired";
  }
}

// ─── getResolvedPlan ──────────────────────────────────────────────────────────
// SHADOW MODE (Phase 2.5) — called fire-and-forget, no enforcement.

/**
 * Shadow-mode plan resolver. Returns a rich ResolvedPlan with:
 *   - Current production plan ID (from getOrgPlan)
 *   - Full plan config (features + quotas) from the plans catalog
 *   - Per-org overrides from org_feature_overrides / org_quota_overrides
 *   - Mismatch report: org_config.modules vs plan defaults; legacy quotas vs catalog
 *
 * Logs:
 *   INFO  — plan.config.features and plan.config.quotas on every call
 *   WARN  — plan_not_in_catalog
 *   WARN  — any module or quota mismatch found
 *   INFO  — full resolution context (for metrics / dashboards)
 *
 * Never throws. Returns a safe default plan on any failure.
 */
export async function getResolvedPlan(orgId: number): Promise<ResolvedPlan> {
  const now = new Date();

  // ── Step 1: Resolve plan ID (same logic as getOrgPlan, no extra DB round-trip) ─
  let planId = "expired";
  let source: PlanSource = "default_free";

  try {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organizationId, orgId))
      .limit(1);

    if (sub?.planId) {
      planId = normalizePlanId(sub.planId);
      source = "subscriptions";
    } else {
      const [org] = await db
        .select({ subscriptionTier: organizationsTable.subscriptionTier })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId))
        .limit(1);
      planId = normalizePlanId(org?.subscriptionTier);
      source = org ? "org_fallback" : "default_free";
    }
  } catch (err) {
    logger.error({ err, orgId }, "[plan-service:shadow] error resolving plan ID — using expired");
  }

  // ── Step 2: Look up plan definition in the plans catalog ───────────────────
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
        "[plan-service:shadow] plan_not_in_catalog: run seedPlans() to populate",
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
      .where(and(
        eq(orgFeatureOverridesTable.organizationId, orgId),
        or(isNull(orgFeatureOverridesTable.expiresAt), gt(orgFeatureOverridesTable.expiresAt, now)),
      ));

    for (const row of rows) featureOverrides[row.featureKey] = row.isEnabled;
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
      .where(and(
        eq(orgQuotaOverridesTable.organizationId, orgId),
        or(isNull(orgQuotaOverridesTable.expiresAt), gt(orgQuotaOverridesTable.expiresAt, now)),
      ));

    for (const row of rows) quotaOverrides[row.quotaKey] = row.quotaValue;
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

  // ── Step 5: Compute effective values (plan defaults + quota overrides) ─────
  const baseMaxUsers          = planRow?.maxUsers          ?? null;
  const baseStorageMb         = planRow?.storageMb         ?? null;
  const baseMigrationMaxFiles = planRow?.migrationMaxFiles ?? null;
  const baseRateLimitRpm      = planRow?.rateLimitRpm      ?? null;

  const applyQuota = (base: number | null, key: string): number | null => {
    if (!(key in quotaOverrides)) return base;
    const v = quotaOverrides[key];
    return v === -1 ? null : v;
  };

  const effectiveMaxUsers          = applyQuota(baseMaxUsers, "max_users");
  const effectiveStorageMb         = applyQuota(baseStorageMb, "storage_mb");
  const effectiveMigrationMaxFiles = applyQuota(baseMigrationMaxFiles, "migration_max_files");
  const effectiveRateLimitRpm      = applyQuota(baseRateLimitRpm, "rate_limit_rpm");

  // ── Step 6: Module mismatch — org_config.modules vs plan defaults ──────────
  // Reads org_config to compare what the org has enabled vs what the plan says
  // it should have.  Logs WARN on any mismatch.  Does NOT change org_config.
  const moduleMismatches: ModuleMismatch[] = [];

  try {
    const [cfg] = await db
      .select({ modules: orgConfigTable.modules })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, orgId))
      .limit(1);

    if (cfg?.modules) {
      const orgModules = cfg.modules as Record<string, boolean>;
      const planModules = getDefaultModulesForPlan(planId);

      for (const [mod, planDefault] of Object.entries(planModules)) {
        const orgValue = orgModules[mod] ?? true; // missing key = enabled (backfill policy)
        if (orgValue !== planDefault) {
          moduleMismatches.push({ module: mod, orgValue, planDefault });
        }
      }

      if (moduleMismatches.length > 0) {
        logger.warn(
          { orgId, planId, mismatches: moduleMismatches },
          "[plan-service:shadow] MODULE_MISMATCH: org_config.modules differs from plan defaults — " +
          "org may have been manually configured, or plan changed after org_config was set. " +
          "No enforcement change (shadow mode).",
        );
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "[plan-service:shadow] DB error reading org_config for mismatch check");
  }

  // ── Step 7: Quota mismatch — legacy hardcoded values vs plans catalog ──────
  // Compares what the running middleware actually uses (TIER_RPM, PLAN_LIMITS)
  // with what the plans catalog row says.  Logs WARN on any mismatch.
  const quotaMismatches: QuotaMismatch[] = [];

  if (planRow) {
    // Rate-limit RPM
    const legacyRpm     = LEGACY_TIER_RPM[planId] ?? null;
    const catalogRpm    = planRow.rateLimitRpm ?? null;
    if (legacyRpm !== catalogRpm) {
      quotaMismatches.push({
        quota:        "rate_limit_rpm",
        legacyValue:  legacyRpm,
        catalogValue: catalogRpm,
      });
    }

    // Migration max files (-1 in catalog = unlimited = Infinity in legacy)
    const legacyMigration  = LEGACY_PLAN_LIMITS[planId] ?? 0;
    const catalogMigration = planRow.migrationMaxFiles ?? 0;
    // Normalise: Infinity in legacy = -1 in catalog
    const legacyNorm = legacyMigration === Infinity ? -1 : legacyMigration;
    if (legacyNorm !== catalogMigration) {
      quotaMismatches.push({
        quota:        "migration_max_files",
        legacyValue:  legacyNorm,
        catalogValue: catalogMigration,
      });
    }

    if (quotaMismatches.length > 0) {
      logger.warn(
        { orgId, planId, mismatches: quotaMismatches },
        "[plan-service:shadow] QUOTA_MISMATCH: legacy hardcoded limits differ from plans catalog — " +
        "catalog values are authoritative in Phase 3+. No enforcement change (shadow mode).",
      );
    }
  }

  const mismatch: MismatchReport = {
    modules:       moduleMismatches,
    quotas:        quotaMismatches,
    hasMismatches: moduleMismatches.length > 0 || quotaMismatches.length > 0,
  };

  // ── Step 8: Build config object and log resolution summary ─────────────────
  const planFeatures = planRow
    ? (Array.isArray(planRow.features) ? (planRow.features as string[]) : [])
    : [];

  const effectiveQuotas: PlanQuotas = {
    maxUsers:          effectiveMaxUsers,
    storageMb:         effectiveStorageMb,
    migrationMaxFiles: effectiveMigrationMaxFiles,
    rateLimitRpm:      effectiveRateLimitRpm,
  };

  // Log plan.config.features and plan.config.quotas on every call
  logger.info(
    {
      orgId,
      planId,
      source,
      "plan.config.features": planFeatures,
      "plan.config.quotas":   effectiveQuotas,
      planNotInCatalog,
      hasFeatureOverrides,
      hasQuotaOverrides,
      hasMismatches: mismatch.hasMismatches,
    },
    "[plan-service:shadow] resolved plan",
  );

  return {
    planId,
    source,
    name:               planRow?.name      ?? null,
    priceAed:           planRow?.priceAed  ?? null,
    config: {
      features: planFeatures,
      quotas:   effectiveQuotas,
    },
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
    mismatch,
    planNotInCatalog,
    hasFeatureOverrides,
    hasQuotaOverrides,
  };
}
