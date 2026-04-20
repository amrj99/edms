/**
 * Module Sync Scheduler — Phase 3
 *
 * Runs syncAllOrgModules() on a fixed interval so org_config.modules
 * stays aligned with the plans catalog + org overrides at all times.
 *
 * Schedule:
 *   - First run: 2 minutes after startup (lets the server warm up)
 *   - Subsequent runs: every 30 minutes
 *
 * Behaviour:
 *   - Single-writer: uses a boolean flag to prevent overlapping runs
 *   - Any per-org error is logged but does NOT stop the batch (see syncAllOrgModules)
 *   - Scheduler errors do NOT crash the process
 *
 * Override via env:
 *   MODULE_SYNC_INTERVAL_MS   — interval in ms  (default: 1_800_000 = 30 min)
 *   MODULE_SYNC_INITIAL_MS    — first-run delay (default:    120_000 =  2 min)
 */

import { logger } from "./logger.js";
import { syncAllOrgModules } from "./module-sync-service.js";

const INTERVAL_MS = Number(process.env.MODULE_SYNC_INTERVAL_MS) || 30 * 60_000;
const INITIAL_MS  = Number(process.env.MODULE_SYNC_INITIAL_MS)  ||  2 * 60_000;

const LABEL = "[module-sync-scheduler]";

let running = false;

async function runSync(): Promise<void> {
  if (running) {
    logger.debug(`${LABEL} previous run still in progress — skipping`);
    return;
  }
  running = true;
  try {
    logger.info(`${LABEL} starting scheduled sync`);
    const report = await syncAllOrgModules();
    logger.info(
      {
        total:      report.total,
        updated:    report.updated,
        skipped:    report.skipped,
        errors:     report.errors,
        durationMs: report.durationMs,
      },
      `${LABEL} scheduled sync complete`,
    );
  } catch (err) {
    logger.error({ err }, `${LABEL} unexpected error during scheduled sync`);
  } finally {
    running = false;
  }
}

export function startModuleSyncScheduler(): void {
  logger.info(
    { initialDelayMs: INITIAL_MS, intervalMs: INTERVAL_MS },
    `${LABEL} module sync scheduler started`,
  );

  // First run after startup delay
  setTimeout(() => {
    runSync().catch((err) =>
      logger.error({ err }, `${LABEL} initial run failed`),
    );

    // Subsequent runs on fixed interval
    setInterval(() => {
      runSync().catch((err) =>
        logger.error({ err }, `${LABEL} interval run failed`),
      );
    }, INTERVAL_MS);
  }, INITIAL_MS);
}
