/**
 * PlanService — single source of truth for an organisation's subscription plan.
 *
 * Resolution order (Phase 1):
 *   1. subscriptions.plan_id            — PRIMARY SSOT (Stripe-managed)
 *   2. organizations.subscription_tier  — LEGACY FALLBACK (kept for backward
 *                                         compatibility; will be removed in Phase 2)
 *
 * When the fallback is used, a WARN log is emitted so operators can identify
 * organisations that have not yet been migrated to the subscriptions table.
 *
 * Usage:
 *   import { getOrgPlan } from "../lib/plan-service.js";
 *   const planId = await getOrgPlan(orgId); // "free" | "starter" | "basic" | ...
 */
import { db } from "@workspace/db";
import { subscriptionsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

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
