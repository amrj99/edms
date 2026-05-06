/**
 * ModuleSyncService — Phase 3
 *
 * Computes the effective modules for an organisation from:
 *   1. Plan defaults  (getDefaultModulesForPlan → plans catalog)
 *   2. Org feature overrides (org_feature_overrides table — active, non-expired rows)
 *
 * Then writes the effective result into org_config.modules.
 *
 * Guarantees:
 *   ✅ All module keys are always written explicitly (no missing / implicit values)
 *   ✅ Org feature overrides take precedence over plan defaults
 *   ✅ Idempotent — skips UPDATE if computed === current (byte-for-byte JSON match)
 *   ✅ Never throws — logs errors per org, always continues
 *
 * Used by:
 *   - startModuleSyncScheduler() — periodic background reconciliation (every 30 min)
 *   - resetModulesToPlan()       — startup clean-slate reset (Phase 2.95)
 *   - requireModule canary path  — on-demand per-org computation (Phase 3)
 *
 * NOT used for enforcement directly.  org_config.modules is the runtime gate.
 * requireModule reads org_config.modules; ModuleSyncService keeps it fresh.
 */

import { db } from "@workspace/db";
import {
  organizationsTable,
  orgConfigTable,
  subscriptionsTable,
  orgFeatureOverridesTable,
} from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getDefaultModulesForPlan, type OrgModuleFlags } from "./plans.js";
import { normalizePlanId } from "./plan-normalizer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgSyncResult {
  orgId:    number;
  orgName:  string;
  planId:   string;
  source:   "subscriptions" | "org_fallback" | "default_free";
  status:   "updated" | "skipped" | "no_config" | "error";
  before?:  Record<string, boolean>;
  after?:   Record<string, boolean>;
  overrides?: Record<string, boolean>;
  error?:   string;
}

export interface SyncReport {
  total:    number;
  updated:  number;
  skipped:  number;
  errors:   number;
  noConfig: number;
  results:  OrgSyncResult[];
  durationMs: number;
}

// ─── computeEffectiveModules ──────────────────────────────────────────────────

/**
 * Compute effective module flags for an org:
 *   effective[mod] = plan_default[mod] XOR active_feature_override[mod]
 *
 * Feature overrides can enable OR disable a module regardless of plan default.
 * Only active overrides (expires_at IS NULL OR expires_at > NOW) are applied.
 *
 * Returns a fully-specified object with every module key.
 */
export async function computeEffectiveModules(
  orgId:  number,
  planId: string,
): Promise<{ effective: OrgModuleFlags; overrides: Record<string, boolean> }> {
  const planDefaults = getDefaultModulesForPlan(planId);
  const overrides: Record<string, boolean> = {};

  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(orgFeatureOverridesTable)
      .where(and(
        eq(orgFeatureOverridesTable.organizationId, orgId),
        or(
          isNull(orgFeatureOverridesTable.expiresAt),
          gt(orgFeatureOverridesTable.expiresAt, now),
        ),
      ));

    for (const row of rows) {
      overrides[row.featureKey] = row.isEnabled;
    }
  } catch (err) {
    logger.error(
      { err, orgId, planId },
      "[module-sync] DB error reading org_feature_overrides — using plan defaults only",
    );
  }

  const effective: OrgModuleFlags = { ...planDefaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in effective) {
      (effective as Record<string, boolean>)[key] = value;
    }
  }

  return { effective, overrides };
}

// ─── syncOrgModules ───────────────────────────────────────────────────────────

/**
 * Sync org_config.modules for a single org.
 *
 * Resolution order for planId:
 *   1. subscriptions.plan_id       — Stripe SSOT
 *   2. organizations.subscription_tier — legacy fallback
 *   3. "free"                      — hard default
 *
 * If modules already match the computed effective set → skip (no UPDATE).
 */
export async function syncOrgModules(
  orgId:   number,
  orgName: string,
): Promise<OrgSyncResult> {
  const LABEL = "[module-sync]";

  // ── Step 1: Resolve plan ──────────────────────────────────────────────────
  let planId = "expired";
  let source: OrgSyncResult["source"] = "default_free";

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
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, orgId, orgName }, `${LABEL} error resolving plan — defaulting to expired`);
    return { orgId, orgName, planId: "expired", source: "default_free", status: "error", error: msg };
  }

  // ── Step 2: Compute effective modules (plan defaults + overrides) ─────────
  const { effective, overrides } = await computeEffectiveModules(orgId, planId);

  // ── Step 3: Read current org_config.modules ───────────────────────────────
  let currentModules: Record<string, boolean> | null = null;

  try {
    const [cfg] = await db
      .select({ modules: orgConfigTable.modules })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, orgId))
      .limit(1);

    currentModules = (cfg?.modules as Record<string, boolean>) ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, orgId, orgName }, `${LABEL} error reading org_config — skipping`);
    return { orgId, orgName, planId, source, status: "error", error: msg };
  }

  if (currentModules === null) {
    logger.warn(
      { orgId, orgName, planId },
      `${LABEL} org has no org_config row — run backfillOrgConfig first`,
    );
    return { orgId, orgName, planId, source, status: "no_config" };
  }

  // ── Step 4: Compare — skip if already matching ───────────────────────────
  const effectiveKeys = Object.keys(effective).sort();
  const currentKeys   = Object.keys(currentModules).sort();

  const alreadyMatch =
    effectiveKeys.join(",") === currentKeys.join(",") &&
    effectiveKeys.every(k => currentModules![k] === (effective as Record<string, boolean>)[k]);

  if (alreadyMatch) {
    logger.debug(
      { orgId, orgName, planId, source },
      `${LABEL} modules already match effective — skipped`,
    );
    return { orgId, orgName, planId, source, status: "skipped" };
  }

  // ── Step 5: UPDATE org_config.modules ────────────────────────────────────
  const overrideCount = Object.keys(overrides).length;

  logger.info(
    {
      orgId,
      orgName,
      planId,
      source,
      before:    currentModules,
      after:     effective,
      overrides: overrideCount > 0 ? overrides : undefined,
    },
    `${LABEL} syncing modules${overrideCount > 0 ? ` (${overrideCount} override(s) applied)` : ""}`,
  );

  try {
    await db
      .update(orgConfigTable)
      .set({ modules: effective })
      .where(eq(orgConfigTable.organizationId, orgId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, orgId, orgName }, `${LABEL} UPDATE failed`);
    return { orgId, orgName, planId, source, status: "error", error: msg };
  }

  return {
    orgId,
    orgName,
    planId,
    source,
    status:    "updated",
    before:    currentModules,
    after:     effective,
    overrides: overrideCount > 0 ? overrides : undefined,
  };
}

// ─── syncAllOrgModules ────────────────────────────────────────────────────────

/**
 * Sync org_config.modules for every organization.
 * Continues on per-org error — never aborts the batch.
 * Returns a SyncReport with per-org results.
 */
export async function syncAllOrgModules(): Promise<SyncReport> {
  const LABEL = "[module-sync]";
  const startMs = Date.now();

  // Fetch all orgs
  let orgs: Array<{ id: number; name: string }> = [];

  try {
    const rows = await db.execute<{ id: number; name: string }>(sql`
      SELECT id, name FROM organizations ORDER BY id
    `);
    orgs = (rows.rows ?? (rows as any)) as Array<{ id: number; name: string }>;
  } catch (err) {
    logger.error({ err }, `${LABEL} failed to fetch organizations — aborting sync`);
    return { total: 0, updated: 0, skipped: 0, errors: 1, noConfig: 0, results: [], durationMs: Date.now() - startMs };
  }

  const results: OrgSyncResult[] = [];

  for (const org of orgs) {
    try {
      const result = await syncOrgModules(org.id, org.name);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, orgId: org.id }, `${LABEL} unexpected error for org — continuing`);
      results.push({ orgId: org.id, orgName: org.name, planId: "unknown", source: "default_free", status: "error", error: msg });
    }
  }

  const report: SyncReport = {
    total:      results.length,
    updated:    results.filter(r => r.status === "updated").length,
    skipped:    results.filter(r => r.status === "skipped").length,
    errors:     results.filter(r => r.status === "error").length,
    noConfig:   results.filter(r => r.status === "no_config").length,
    results,
    durationMs: Date.now() - startMs,
  };

  const level = report.errors > 0 ? "warn" : "info";
  logger[level](
    {
      total:      report.total,
      updated:    report.updated,
      skipped:    report.skipped,
      errors:     report.errors,
      noConfig:   report.noConfig,
      durationMs: report.durationMs,
    },
    `${LABEL} syncAllOrgModules complete`,
  );

  return report;
}
