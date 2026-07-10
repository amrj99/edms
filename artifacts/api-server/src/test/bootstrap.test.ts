/**
 * bootstrap.test.ts — app/bootstrap separation contract.
 *
 * Pure unit test: every startup dependency is mocked, so this test performs NO
 * real DB activity and starts NO real timers. It proves the entry-point contract:
 *   - critical startup (integrity + RLS) is awaited and ordered before anything else;
 *   - a FATAL step failing rejects runCriticalStartup() → index.ts refuses to listen;
 *   - a non-fatal seed failing does NOT reject (server still starts);
 *   - background jobs start only after critical init and are fully stoppable.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks (no real DB, no real timers fired) ───────────────────────────────────
const calls: string[] = [];
const mk = (name: string, impl?: () => Promise<unknown>) =>
  vi.fn(async () => { calls.push(name); return impl ? impl() : undefined; });

const integrity = mk("integrity");
const rls = mk("rls");
const plans = mk("plans");
const admin = mk("admin");
const backfill = mk("backfill");
const resetModules = mk("resetModules");
const moduleSyncStop = vi.fn();
const startModuleSync = vi.fn(() => { calls.push("moduleSync"); return { stop: moduleSyncStop }; });
const skills = vi.fn(async () => {});
const reminders = vi.fn(async () => {});

vi.mock("../lib/integrity-migrations.js", () => ({ runIntegrityMigrations: () => integrity() }));
vi.mock("../lib/rls-init.js", () => ({ initRlsPolicies: () => rls() }));
vi.mock("../lib/seed-plans.js", () => ({ seedPlans: () => plans() }));
vi.mock("../lib/seed.js", () => ({ seedDefaultAdmin: () => admin() }));
vi.mock("../lib/backfill-org-config.js", () => ({ backfillOrgConfig: () => backfill() }));
vi.mock("../lib/reset-modules-to-plan.js", () => ({ resetModulesToPlan: () => resetModules() }));
vi.mock("../lib/module-sync-scheduler.js", () => ({ startModuleSyncScheduler: () => startModuleSync() }));
vi.mock("../lib/skill-engine.js", () => ({ runScheduledSkills: () => skills() }));
vi.mock("../lib/reminder-job.js", () => ({ sendDueDateReminders: () => reminders() }));

const { runCriticalStartup, startBackgroundJobs } = await import("../bootstrap.js");

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("bootstrap — critical startup", () => {
  it("awaits integrity and RLS FIRST, before seeds", async () => {
    await runCriticalStartup();
    // integrity + rls must precede the seed steps
    expect(calls[0]).toBe("integrity");
    expect(calls[1]).toBe("rls");
    expect(calls).toContain("plans");
    expect(calls.indexOf("rls")).toBeLessThan(calls.indexOf("plans"));
  });

  it("REJECTS when integrity migrations fail (server must not start)", async () => {
    integrity.mockRejectedValueOnce(new Error("integrity boom"));
    await expect(runCriticalStartup()).rejects.toThrow("integrity boom");
  });

  it("REJECTS when RLS init fails (security-critical)", async () => {
    rls.mockRejectedValueOnce(new Error("rls boom"));
    await expect(runCriticalStartup()).rejects.toThrow("rls boom");
  });

  it("does NOT reject when a non-fatal seed fails (server still starts)", async () => {
    plans.mockRejectedValueOnce(new Error("plans boom"));
    await expect(runCriticalStartup()).resolves.toBeUndefined();
  });
});

describe("bootstrap — background jobs", () => {
  it("starts the module-sync scheduler and is fully stoppable", () => {
    vi.useFakeTimers();
    try {
      const handles = startBackgroundJobs();
      expect(startModuleSync).toHaveBeenCalledOnce();

      // No cron has fired yet (delays not elapsed)
      expect(skills).not.toHaveBeenCalled();
      expect(reminders).not.toHaveBeenCalled();

      // stopAll must clear every timer — module-sync stop + no pending timers
      handles.stopAll();
      expect(moduleSyncStop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reminder + skill crons fire on their delay and stop cleanly", () => {
    vi.useFakeTimers();
    try {
      const handles = startBackgroundJobs();
      vi.advanceTimersByTime(60_000);        // skill initial (60s) + reminder (30s) elapsed
      expect(reminders).toHaveBeenCalled();
      expect(skills).toHaveBeenCalled();
      handles.stopAll();
      expect(vi.getTimerCount()).toBe(0);    // no lingering intervals
    } finally {
      vi.useRealTimers();
    }
  });
});
