// ─── Trial plan constants ──────────────────────────────────────────────────────
export const TRIAL_PLAN_ID = "trial";
export const TRIAL_DAYS = 14;
export const TRIAL_AI_CREDITS = 1_000;
export const TRIAL_MAX_USERS = 3;
export const TRIAL_STORAGE_MB = 2048;      // 2 GB
export const TRIAL_MAX_FILE_MB = 50;
export const TRIAL_MAX_PROJECTS = 1;

// ─── Free plan constants (post-trial fallback tier) ────────────────────────────
// Free is NOT a marketing tier — it is the state an org enters after a trial
// expires without upgrading. Its purpose is to preserve data while restricting
// new activity, giving the admin a clear path to upgrade without data loss.
export const FREE_PLAN_ID = "free";
export const FREE_MAX_USERS = 1;
export const FREE_STORAGE_MB = 512;        // 500 MB (binary: 512 MiB)
export const FREE_MAX_FILE_MB = 100;
export const FREE_MAX_PROJECTS = 1;
export const FREE_AI_CREDITS = 0;          // no AI on free plan

// ─── Trial date helpers ────────────────────────────────────────────────────────

export function getTrialEndDate(): Date {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export function isTrialExpired(trialEndsAt: Date | string | null | undefined): boolean {
  if (!trialEndsAt) return false;
  return new Date() > new Date(trialEndsAt);
}

export function trialDaysRemaining(trialEndsAt: Date | string | null | undefined): number {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
