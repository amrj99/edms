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

const rls = mk("rls");
const admin = mk("admin");
const backfill = mk("backfill");
const resetModules = mk("resetModules");
const moduleSyncStop = vi.fn();
const startModuleSync = vi.fn(() => { calls.push("moduleSync"); return { stop: moduleSyncStop }; });
const skills = vi.fn(async () => {});
const reminders = vi.fn(async () => {});

// DEBT-010: the runtime does NO DDL and no schema/RLS install — those moved to the
// migrator (migrate.ts). Startup only VERIFIES RLS is present (read-only, FATAL) via
// assertMembershipRlsInstalled; the pool it reads is mocked. integrity-migrations and
// seed-plans are NOT imported by bootstrap anymore, so they are not mocked here.
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../lib/rls-membership.js", () => ({ assertMembershipRlsInstalled: () => rls() }));
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
  it("VERIFIES RLS FIRST, before the runtime-init (DML) steps", async () => {
    await runCriticalStartup();
    // The read-only RLS presence check is the first (and only FATAL) step, before
    // the non-fatal DML runtime init. No DDL/install steps run in the runtime.
    expect(calls[0]).toBe("rls");
    expect(calls).toContain("backfill");
    expect(calls.indexOf("rls")).toBeLessThan(calls.indexOf("backfill"));
  });

  it("REJECTS when the RLS presence check fails (security-critical)", async () => {
    // assertMembershipRlsInstalled throwing (migrator hasn't installed RLS) must
    // stop the server from listening — the sole FATAL startup contract.
    rls.mockRejectedValueOnce(new Error("rls boom"));
    await expect(runCriticalStartup()).rejects.toThrow("rls boom");
  });

  it("does NOT reject when a non-fatal runtime-init step fails (server still starts)", async () => {
    backfill.mockRejectedValueOnce(new Error("backfill boom"));
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
