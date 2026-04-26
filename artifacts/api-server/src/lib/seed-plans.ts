/**
 * seedPlans — ensure the plan-catalog tables exist, then populate `plans`.
 *
 * SELF-BOOTSTRAPPING: this function creates the three Phase-2 tables using
 * CREATE TABLE IF NOT EXISTS before attempting any INSERT.  This means:
 *   - drizzle-kit push is NOT required for these tables in any environment.
 *   - No interactive prompts, no CI/Docker breakage.
 *   - Idempotent — safe to run on every startup.
 *
 * Why not drizzle-kit push?
 *   drizzle-kit push asks interactive questions ("is this a rename or a new
 *   table?") that cannot be answered non-interactively.  A production Docker
 *   container cannot respond, so the push times out or is never run, leaving
 *   the tables absent.  Self-bootstrapping DDL is the only reliable pattern.
 *
 * Shadow mode (Phase 2):
 *   - No existing route or middleware reads from these tables for enforcement.
 *   - getResolvedPlan() reads `plans` only for mismatch-detection logging.
 *   - No old columns removed.  No production behaviour changed.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Plan seed data ───────────────────────────────────────────────────────────
// Mirrors PLANS in lib/plans.ts + inline limits from routes/migrations.ts
// and middlewares/tenant-rate-limit.ts.  Phase 3+ will make this the SSOT.

const PLAN_SEED_DATA = [
  {
    planId:             "free",
    name:               "Free",
    description:        "Basic access with no subscription",
    priceAed:           0,
    currency:           "aed",
    interval:           "month",
    maxUsers:           null as number | null,
    storageMb:          0,
    migrationMaxFiles:  0,
    rateLimitRpm:       300 as number | null,
    features:           [] as string[],
    stripePriceEnv:     null as string | null,
    isActive:           true,
  },
  {
    planId:             "starter",
    name:               "Starter",
    description:        "Essential document management for small teams",
    priceAed:           45,
    currency:           "aed",
    interval:           "month",
    maxUsers:           10 as number | null,
    storageMb:          51200,
    migrationMaxFiles:  0,
    rateLimitRpm:       400 as number | null,
    features:           [
      "Up to 10 users",
      "50 GB storage",
      "Basic transmittal management",
      "Standard support",
      "Document versioning",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_STARTER" as string | null,
    isActive:           true,
  },
  {
    planId:             "basic",
    name:               "Basic",
    description:        "Full EDMS for growing engineering teams",
    priceAed:           65,
    currency:           "aed",
    interval:           "month",
    maxUsers:           25 as number | null,
    storageMb:          256000,
    migrationMaxFiles:  200,
    rateLimitRpm:       600 as number | null,
    features:           [
      "Up to 25 users",
      "250 GB storage",
      "Transmittal & register management",
      "Email support",
      "AI-assisted linking",
      "Rules engine",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_BASIC" as string | null,
    isActive:           true,
  },
  {
    planId:             "professional",
    name:               "Professional",
    description:        "Advanced EDMS for large projects",
    priceAed:           80,
    currency:           "aed",
    interval:           "month",
    maxUsers:           100 as number | null,
    storageMb:          1048576,
    migrationMaxFiles:  1000,
    rateLimitRpm:       1500 as number | null,
    features:           [
      "Up to 100 users",
      "1 TB storage",
      "All registers (ITR, NCR, NOC)",
      "Priority support",
      "Advanced analytics",
      "Custom workflows",
      "API access",
    ] as string[],
    stripePriceEnv:     "STRIPE_PRICE_PROFESSIONAL" as string | null,
    isActive:           true,
  },
  {
    planId:             "enterprise",
    name:               "Enterprise",
    description:        "Unlimited scale for large organisations",
    priceAed:           95,
    currency:           "aed",
    interval:           "month",
    maxUsers:           null as number | null,
    storageMb:          1048576,
    migrationMaxFiles:  -1,
    rateLimitRpm:       null as number | null,
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
    stripePriceEnv:     "STRIPE_PRICE_ENTERPRISE" as string | null,
    isActive:           true,
  },
];

// ─── DDL: ensure tables exist ─────────────────────────────────────────────────
// Called at the start of seedPlans() so the function is completely
// self-contained and works in any environment without drizzle-kit.

async function ensureTablesExist(): Promise<void> {
  // plans — no foreign keys, safe to create first
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS plans (
      id                   SERIAL PRIMARY KEY,
      plan_id              TEXT    NOT NULL UNIQUE,
      name                 TEXT    NOT NULL,
      description          TEXT,
      price_aed            INTEGER NOT NULL DEFAULT 0,
      currency             TEXT    NOT NULL DEFAULT 'aed',
      interval             TEXT    NOT NULL DEFAULT 'month',
      max_users            INTEGER,
      storage_mb           INTEGER NOT NULL DEFAULT 0,
      migration_max_files  INTEGER NOT NULL DEFAULT 0,
      rate_limit_rpm       INTEGER,
      features             JSONB   NOT NULL DEFAULT '[]',
      stripe_price_env     TEXT,
      is_active            BOOLEAN NOT NULL DEFAULT true,
      created_at           TIMESTAMP NOT NULL DEFAULT now(),
      updated_at           TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  // org_feature_overrides — references organizations + users (both exist in prod)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_feature_overrides (
      id                 SERIAL PRIMARY KEY,
      organization_id    INTEGER NOT NULL
                           REFERENCES organizations(id) ON DELETE CASCADE,
      feature_key        TEXT    NOT NULL,
      is_enabled         BOOLEAN NOT NULL,
      reason             TEXT,
      granted_by_user_id INTEGER REFERENCES users(id),
      expires_at         TIMESTAMP,
      created_at         TIMESTAMP NOT NULL DEFAULT now(),
      updated_at         TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT org_feature_overrides_org_feature_uq
        UNIQUE (organization_id, feature_key)
    )
  `);

  // org_quota_overrides — same FK pattern
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_quota_overrides (
      id                 SERIAL PRIMARY KEY,
      organization_id    INTEGER NOT NULL
                           REFERENCES organizations(id) ON DELETE CASCADE,
      quota_key          TEXT    NOT NULL,
      quota_value        INTEGER NOT NULL,
      reason             TEXT,
      granted_by_user_id INTEGER REFERENCES users(id),
      expires_at         TIMESTAMP,
      created_at         TIMESTAMP NOT NULL DEFAULT now(),
      updated_at         TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT org_quota_overrides_org_quota_uq
        UNIQUE (organization_id, quota_key)
    )
  `);
}

// ─── seedPlans ────────────────────────────────────────────────────────────────

export async function seedPlans(): Promise<void> {
  try {
    // 1️⃣  Guarantee tables exist before any DML
    await ensureTablesExist();

    // 2️⃣  Upsert all plans
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
          name                = EXCLUDED.name,
          description         = EXCLUDED.description,
          price_aed           = EXCLUDED.price_aed,
          currency            = EXCLUDED.currency,
          interval            = EXCLUDED.interval,
          max_users           = EXCLUDED.max_users,
          storage_mb          = EXCLUDED.storage_mb,
          migration_max_files = EXCLUDED.migration_max_files,
          rate_limit_rpm      = EXCLUDED.rate_limit_rpm,
          features            = EXCLUDED.features,
          stripe_price_env    = EXCLUDED.stripe_price_env,
          is_active           = EXCLUDED.is_active,
          updated_at          = now()
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
    // Non-fatal in shadow mode — log and continue startup
    logger.error(
      { err },
      "[seed-plans] failed — getResolvedPlan() will log warnings until resolved",
    );
  }
}
