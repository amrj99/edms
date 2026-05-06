/**
 * resetModulesToPlan — Phase 2.95
 *
 * Resets org_config.modules for EVERY organization to exactly match
 * getDefaultModulesForPlan(planId).
 *
 * Guarantees after running:
 *   ✅ All module keys exist explicitly (no missing / implicit values)
 *   ✅ No plan_gap mismatches (no module enabled above plan's entitlement)
 *   ✅ No orphan mismatches (no key absent relying on ?? true backfill policy)
 *   ✅ Shadow middleware will report hasMismatches: false for all orgs
 *
 * Safety:
 *   - Idempotent: if modules already match plan defaults exactly, the row is skipped (no UPDATE).
 *   - Safe to run on every restart.
 *   - Test/demo data only — does NOT preserve existing module states.
 *
 * Plan resolution order (same as getOrgPlan):
 *   1. subscriptions.plan_id      — Stripe-managed SSOT
 *   2. organizations.subscription_tier — legacy fallback
 *   3. "free"                     — final default
 */

import { db } from "@workspace/db";
import { organizationsTable, orgConfigTable, subscriptionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getDefaultModulesForPlan } from "./plans.js";
import { normalizePlanId } from "./plan-normalizer.js";

export async function resetModulesToPlan(): Promise<void> {
  const LABEL = "[reset-modules]";

  try {
    // ── 1. Fetch all orgs with their plan (subscriptions preferred) ──────────
    const rows = await db.execute<{
      org_id:             number;
      org_name:           string;
      subscription_tier:  string | null;
      sub_plan_id:        string | null;
      current_modules:    Record<string, boolean> | null;
    }>(sql`
      SELECT
        o.id                    AS org_id,
        o.name                  AS org_name,
        o.subscription_tier,
        s.plan_id               AS sub_plan_id,
        oc.modules              AS current_modules
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN org_config    oc ON oc.organization_id = o.id
      ORDER BY o.id
    `);

    const orgs: typeof rows.rows = rows.rows ?? (rows as any);

    if (!Array.isArray(orgs) || orgs.length === 0) {
      logger.info(`${LABEL} no organizations found — nothing to do`);
      return;
    }

    let skipped  = 0;
    let updated  = 0;
    let noConfig = 0;

    for (const row of orgs) {
      const orgId   = (row as any).org_id   as number;
      const orgName = (row as any).org_name as string;

      // ── 2. Resolve plan ID ───────────────────────────────────────────────
      const planId: string = normalizePlanId(
        ((row as any).sub_plan_id as string | null) ??
        ((row as any).subscription_tier as string | null),
      );

      const source = (row as any).sub_plan_id ? "subscriptions" : "org_fallback";

      // ── 3. Get exact plan defaults ───────────────────────────────────────
      const planDefaults = getDefaultModulesForPlan(planId);

      // ── 4. Skip if no org_config row (backfillOrgConfig should have run first) ─
      const currentModules = (row as any).current_modules as Record<string, boolean> | null;

      if (!currentModules) {
        logger.warn(
          { orgId, orgName, planId },
          `${LABEL} org has no org_config row — run backfillOrgConfig first, skipping`,
        );
        noConfig++;
        continue;
      }

      // ── 5. Check whether modules already match plan defaults exactly ─────
      //    "Exactly" means: every key in planDefaults is present in currentModules
      //    with the same boolean value AND currentModules has no extra keys.
      const planKeys    = Object.keys(planDefaults).sort();
      const currentKeys = Object.keys(currentModules).sort();

      const alreadyMatch =
        planKeys.join(",") === currentKeys.join(",") &&
        planKeys.every(k => currentModules[k] === (planDefaults as Record<string, boolean>)[k]);

      if (alreadyMatch) {
        logger.info(
          { orgId, orgName, planId, source },
          `${LABEL} modules already match plan defaults — skipped`,
        );
        skipped++;
        continue;
      }

      // ── 6. Log before / after ────────────────────────────────────────────
      logger.info(
        {
          orgId,
          orgName,
          planId,
          source,
          before: currentModules,
          after:  planDefaults,
        },
        `${LABEL} resetting modules to plan defaults`,
      );

      // ── 7. UPDATE org_config.modules to exact plan defaults ──────────────
      await db
        .update(orgConfigTable)
        .set({ modules: planDefaults })
        .where(eq(orgConfigTable.organizationId, orgId));

      updated++;
    }

    logger.info(
      { total: orgs.length, updated, skipped, noConfig },
      `${LABEL} complete — ${updated} org(s) reset, ${skipped} already correct, ${noConfig} skipped (no config row)`,
    );
  } catch (err) {
    logger.error(
      { err },
      `${LABEL} failed — continuing, but org modules may not match plan defaults`,
    );
  }
}
