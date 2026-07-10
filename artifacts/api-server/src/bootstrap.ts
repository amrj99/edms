// Production bootstrap — all startup side-effects live here, NOT in app.ts.
//
// app.ts is pure (middleware + routes + error handling) so the test harness can
// import it without triggering seeds, migrations, schedulers, or timers. This
// module is imported only by the real server entrypoint (index.ts).
//
// Two phases, deliberately separated:
//   1. runCriticalStartup() — awaited BEFORE the server listens.
//        - integrity + RLS are FATAL: if they fail the server must not accept
//          requests (throws → index.ts exits non-zero).
//        - seeds/backfill/module-reset are awaited but non-fatal (logged), matching
//          the app's prior "continue anyway" semantics — now ordered and awaited
//          instead of racing as fire-and-forget promises.
//   2. startBackgroundJobs() — timers/schedulers, started only after critical
//        init succeeds. Returns a handle so every timer can be stopped explicitly
//        (graceful shutdown, and deterministic teardown in tests).

import { logger } from "./lib/logger.js";
import { backfillOrgConfig } from "./lib/backfill-org-config.js";
import { seedDefaultAdmin } from "./lib/seed.js";
import { seedPlans } from "./lib/seed-plans.js";
import { runIntegrityMigrations } from "./lib/integrity-migrations.js";
import { resetModulesToPlan } from "./lib/reset-modules-to-plan.js";
import { startModuleSyncScheduler, type SchedulerHandle } from "./lib/module-sync-scheduler.js";
import { initRlsPolicies } from "./lib/rls-init.js";
import { runScheduledSkills } from "./lib/skill-engine.js";
import { sendDueDateReminders } from "./lib/reminder-job.js";

const isProd = process.env.NODE_ENV === "production";

const SKILL_CRON_INITIAL_MS = 60_000;        // 60 s after start
const SKILL_CRON_INTERVAL_MS = 60 * 60_000;  // hourly
const REMINDER_INITIAL_MS = 30_000;          // 30 s after start
const REMINDER_INTERVAL_MS = 60 * 60_000;    // hourly

/** Handles to every background timer/scheduler so shutdown can stop them all. */
export interface StartupHandles {
  stopAll(): void;
}

/**
 * Critical + non-fatal startup, awaited before the server listens.
 * Throws if a FATAL step (integrity migrations, RLS) fails — the caller must
 * then refuse to start the server.
 */
export async function runCriticalStartup(): Promise<void> {
  // ── FATAL: DB constraints must be in place before serving requests ──────────
  // H1 — FK constraints + orphan detection. If this fails the schema guarantees
  // the app relies on are absent, so we must not accept traffic.
  await runIntegrityMigrations();

  // ── FATAL: row-level security must be enabled before serving requests ───────
  // Without RLS, org-isolation policies are missing — a hard security stop.
  await initRlsPolicies();

  // ── Non-fatal, awaited (ordered, no longer fire-and-forget) ─────────────────
  // Plans catalog — getResolvedPlan() falls back gracefully if absent, so a
  // failure here is logged, not fatal.
  await seedPlans().catch((err) =>
    logger.error({ err }, "[seed-plans] startup plan seed failed — continuing"),
  );

  // Dev-only demo credentials. Never in production.
  if (!isProd) {
    await seedDefaultAdmin().catch((err) =>
      logger.error({ err }, "[seed] seedDefaultAdmin failed — continuing"),
    );
  } else {
    logger.info("[seed] seedDefaultAdmin skipped (NODE_ENV=production)");
  }

  // Phase 0 — ensure every org has an org_config row (fail-closed requireModule).
  await backfillOrgConfig().catch((err) =>
    logger.error({ err }, "[backfill] org_config startup backfill failed — continuing"),
  );

  // Phase 2.95 — align org_config.modules with plan defaults + overrides.
  await resetModulesToPlan().catch((err) =>
    logger.error({ err }, "[reset-modules] startup module reset failed — continuing"),
  );
}

/**
 * Start periodic background jobs. Call ONLY after runCriticalStartup() resolves.
 * Returns a handle so all timers can be stopped explicitly.
 */
export function startBackgroundJobs(): StartupHandles {
  const moduleSync: SchedulerHandle = startModuleSyncScheduler();

  // Skill engine cron — first run after a warm-up delay, then hourly.
  let skillInterval: NodeJS.Timeout | undefined;
  const skillInitial = setTimeout(() => {
    runScheduledSkills().catch((err) => logger.warn({ err }, "skill cron: initial run failed"));
    skillInterval = setInterval(() => {
      runScheduledSkills().catch((err) => logger.warn({ err }, "skill cron: periodic run failed"));
    }, SKILL_CRON_INTERVAL_MS);
  }, SKILL_CRON_INITIAL_MS);

  // Due-date / workflow-SLA reminders — first run after a warm-up delay, then hourly.
  let reminderInterval: NodeJS.Timeout | undefined;
  const reminderInitial = setTimeout(() => {
    void sendDueDateReminders();
    reminderInterval = setInterval(() => void sendDueDateReminders(), REMINDER_INTERVAL_MS);
  }, REMINDER_INITIAL_MS);

  return {
    stopAll() {
      moduleSync.stop();
      clearTimeout(skillInitial);
      if (skillInterval) clearInterval(skillInterval);
      clearTimeout(reminderInitial);
      if (reminderInterval) clearInterval(reminderInterval);
    },
  };
}
