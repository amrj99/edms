/**
 * seedPlans — populate the `plans` table from the canonical PLANS array.
 *
 * Safe to call multiple times:
 *   - Uses INSERT … ON CONFLICT (plan_id) DO UPDATE, so re-runs are idempotent.
 *   - Will update all fields if the hardcoded config changes (e.g. price change).
 *   - Runs at startup (see app.ts) before any request is served.
 *
 * No behavior change:
 *   - The plans table is shadow-only in Phase 2.
 *   - No route or middleware reads from it for enforcement yet.
 *   - getResolvedPlan() reads it only for mismatch-detection logging.
 *
 * Plan ID mapping from migration PLAN_LIMITS (routes/migrations.ts):
 *   free → 0 files, starter → 0 files, basic → 200, professional → 1000, enterprise → Infinity
 *
 * Plan ID mapping from rate-limit TIER_RPM (tenant-rate-limit.ts):
 *   free → 300, starter → 400, basic → 600, professional → 1500, enterprise → null (unlimited)
 */

import { db } from "@workspace/db";
import { plansTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Plan definitions ─────────────────────────────────────────────────────────
// Mirrors PLANS in lib/plans.ts plus the implicit "free" plan and inline limits
// from routes/migrations.ts and middlewares/tenant-rate-limit.ts.
// This is the single consolidation point — in Phase 3+ the plans table becomes
// the SSOT and these hardcoded values can be removed.

const PLAN_SEED_DATA = [
  {
    planId:             "free",
    name:               "Free",
    description:        "Basic access with no subscription",
    priceAed:           0,
    currency:           "aed",
    interval:           "month",
    maxUsers:           null,           // no enforced limit in code currently
    storageMb:          0,              // no storage quota auto-set
    migrationMaxFiles:  0,              // migration wizard disabled on free
    rateLimitRpm:       300,
    features:           [] as string[],
    stripePriceEnv:     null,
    isActive:           true,
  },
  {
    planId:             "starter",
    name:               "Starter",
    description:        "Essential document management for small teams",
    priceAed:           45,
    currency:           "aed",
    interval:           "month",
    maxUsers:           10,
    storageMb:          5120,           // 5 GB
    migrationMaxFiles:  0,              // migration wizard disabled on starter
    rateLimitRpm:       400,
    features:           [
      "Up to 10 users",
      "5 GB storage",
      "Basic transmittal management",
      "Standard support",
      "Document versioning",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_STARTER",
    isActive:           true,
  },
  {
    planId:             "basic",
    name:               "Basic",
    description:        "Full EDMS for growing engineering teams",
    priceAed:           65,
    currency:           "aed",
    interval:           "month",
    maxUsers:           25,
    storageMb:          25600,          // 25 GB
    migrationMaxFiles:  200,
    rateLimitRpm:       600,
    features:           [
      "Up to 25 users",
      "25 GB storage",
      "Transmittal & register management",
      "Email support",
      "AI-assisted linking",
      "Rules engine",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_BASIC",
    isActive:           true,
  },
  {
    planId:             "professional",
    name:               "Professional",
    description:        "Advanced EDMS for large projects",
    priceAed:           80,
    currency:           "aed",
    interval:           "month",
    maxUsers:           100,
    storageMb:          102400,         // 100 GB
    migrationMaxFiles:  1000,
    rateLimitRpm:       1500,
    features:           [
      "Up to 100 users",
      "100 GB storage",
      "All registers (ITR, NCR, NOC)",
      "Priority support",
      "Advanced analytics",
      "Custom workflows",
      "API access",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_PROFESSIONAL",
    isActive:           true,
  },
  {
    planId:             "enterprise",
    name:               "Enterprise",
    description:        "Unlimited scale for large organisations",
    priceAed:           95,
    currency:           "aed",
    interval:           "month",
    maxUsers:           null,           // unlimited
    storageMb:          1048576,        // 1 TB
    migrationMaxFiles:  -1,             // -1 = unlimited
    rateLimitRpm:       null,           // null = unlimited (no rate limit)
    features:           [
      "Unlimited users",
      "1 TB storage",
      "All features",
      "Dedicated support",
      "SLA guarantee",
      "On-premise option",
      "Custom integrations",
      "SSO / SAML",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_ENTERPRISE",
    isActive:           true,
  },
] as const;

export async function seedPlans(): Promise<void> {
  try {
    let seeded = 0;
    let updated = 0;

    for (const plan of PLAN_SEED_DATA) {
      const result = await db.execute(sql`
        INSERT INTO plans (
          plan_id, name, description,
          price_aed, currency, interval,
          max_users, storage_mb, migration_max_files, rate_limit_rpm,
          features, stripe_price_env, is_active,
          created_at, updated_at
        ) VALUES (
          ${plan.planId}, ${plan.name}, ${plan.description},
          ${plan.priceAed}, ${plan.currency}, ${plan.interval},
          ${plan.maxUsers ?? null}, ${plan.storageMb}, ${plan.migrationMaxFiles},
          ${plan.rateLimitRpm ?? null},
          ${JSON.stringify(plan.features)}::jsonb,
          ${plan.stripePriceEnv ?? null}, ${plan.isActive},
          now(), now()
        )
        ON CONFLICT (plan_id) DO UPDATE SET
          name               = EXCLUDED.name,
          description        = EXCLUDED.description,
          price_aed          = EXCLUDED.price_aed,
          currency           = EXCLUDED.currency,
          interval           = EXCLUDED.interval,
          max_users          = EXCLUDED.max_users,
          storage_mb         = EXCLUDED.storage_mb,
          migration_max_files = EXCLUDED.migration_max_files,
          rate_limit_rpm     = EXCLUDED.rate_limit_rpm,
          features           = EXCLUDED.features,
          stripe_price_env   = EXCLUDED.stripe_price_env,
          is_active          = EXCLUDED.is_active,
          updated_at         = now()
        RETURNING (xmax = 0) AS inserted
      `);

      const rows = (result as any).rows ?? result;
      const wasInserted = Array.isArray(rows) && rows[0]?.inserted === true;
      if (wasInserted) seeded++; else updated++;
    }

    logger.info(
      { seeded, updated, total: PLAN_SEED_DATA.length },
      "[seed-plans] plans table seeded successfully",
    );
  } catch (err) {
    logger.error(
      { err },
      "[seed-plans] failed to seed plans table — system continues, but getResolvedPlan() will log warnings",
    );
  }
}
