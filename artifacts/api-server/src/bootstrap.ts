// Production bootstrap — all startup side-effects live here, NOT in app.ts.
//
// app.ts is pure (middleware + routes + error handling) so the test harness can
// import it without triggering seeds, migrations, schedulers, or timers. This
// module is imported only by the real server entrypoint (index.ts).
//
// Two phases, deliberately separated:
//   1. runCriticalStartup() — awaited BEFORE the server listens.
//        - The runtime runs as least-privilege edms_app (DML only). ALL DDL/schema/
//          security installation (drizzle migrations, plan tables, integrity
//          constraints, membership-aware RLS) is owned by the MIGRATOR (migrate.ts),
//          NOT here.
//        - RLS PRESENCE check is FATAL: if the migrator has not installed the model
//          the server must not accept requests (throws → index.ts exits non-zero).
//        - seed(dev)/backfill/module-reset are awaited but non-fatal (logged) and are
//          DML-only runtime init — ordered, not fire-and-forget.
//   2. startBackgroundJobs() — timers/schedulers, started only after critical
//        init succeeds. Returns a handle so every timer can be stopped explicitly
//        (graceful shutdown, and deterministic teardown in tests).

import { logger } from "./lib/logger.js";
import { backfillOrgConfig } from "./lib/backfill-org-config.js";
import { seedDefaultAdmin } from "./lib/seed.js";
import { resetModulesToPlan } from "./lib/reset-modules-to-plan.js";
import { startModuleSyncScheduler, type SchedulerHandle } from "./lib/module-sync-scheduler.js";
import { pool } from "@workspace/db";
import { assertMembershipRlsInstalled } from "./lib/rls-membership.js";
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
  // ── FATAL: schema + RLS must be PRESENT before serving requests ─────────────
  // DEBT-010: the runtime runs as the least-privilege edms_app role — DML-only, NO
  // DDL. All privileged schema/DDL/security installation (drizzle migrations, plan
  // tables + reference seed, H1 integrity constraints, membership-aware RLS) is done
  // by the deploy-time MIGRATOR (migrate.ts) as the owner/migrator role. Startup only
  // VERIFIES the membership-aware model is installed (schema `app` + FORCEd RLS +
  // per-table org_isolation_policy) and refuses to start if the migrator has not run.
  await assertMembershipRlsInstalled((s) => pool.query(s));

  // ── Non-fatal runtime init (DML only — no DDL) ──────────────────────────────
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
  // Explicit .catch so a rejection can never surface as an unhandledRejection,
  // even though sendDueDateReminders wraps its own DB work in try/catch.
  const runReminders = () =>
    sendDueDateReminders().catch((err) => logger.warn({ err }, "reminder job: run failed"));
  let reminderInterval: NodeJS.Timeout | undefined;
  const reminderInitial = setTimeout(() => {
    void runReminders();
    reminderInterval = setInterval(() => void runReminders(), REMINDER_INTERVAL_MS);
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
