/**
 * Normalizes plan tier values across the codebase.
 * Both 'free' (legacy DB value) and 'expired' (new canonical name) map to 'expired'.
 * This enables a phased migration without breaking existing data.
 *
 * Phase A: DB still stores 'free'. Code accepts both transparently.
 * Phase B: DB migrated to 'expired'. Normalizer becomes a no-op safety net.
 * Phase C (deferred): Remove 'free' from enum, simplify normalizer.
 */

/**
 * Normalize a plan tier string.
 * 'free' and 'expired' are both treated as the expired/inactive state.
 * null/undefined defaults to 'expired'.
 */
export function normalizePlanId(plan: string | null | undefined): string {
  if (plan === "free" || plan === "expired") return "expired";
  return plan ?? "expired";
}

/**
 * Checks if a plan is in the expired/inactive state.
 * Use this instead of direct === 'free' or === 'expired' comparisons.
 */
export function isExpiredPlan(plan: string | null | undefined): boolean {
  return normalizePlanId(plan) === "expired";
}

/**
 * Checks if a plan has an active paid or trial subscription.
 */
export function hasActiveSubscription(plan: string | null | undefined): boolean {
  const normalized = normalizePlanId(plan);
  return normalized !== "expired" && normalized !== "cancelled";
}
