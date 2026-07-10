// !! MUST be first import — Sentry instruments Node.js internals at load time
import "./instrument.js";

import { createServer } from "http";
import app from "./app.js";
import { runCriticalStartup, startBackgroundJobs, type StartupHandles } from "./bootstrap.js";
import { initSocket } from "./lib/socket.js";
import { logger } from "./lib/logger.js";
import { startNotificationScheduler } from "./lib/notifications/scheduler.js";
import { startTrialDowngradeScheduler } from "./lib/trial-downgrade-scheduler.js";
import { validateStorageAtStartup } from "./lib/storageConfig.js";
import { logAIConfigAtStartup } from "./lib/ai-core.js";
import { seedAISettings } from "./lib/seed-ai-settings.js";
import { seedSecuritySettings } from "./lib/seed-security-settings.js";

// Background-job handles (module-sync, skill cron, reminders) — stopped on shutdown.
let startupHandles: StartupHandles | undefined;

const rawPort = process.env["PORT"];

// ── Graceful shutdown ──────────────────────────────────────────────────────────
// Called on SIGTERM (Docker/pm2 stop) and SIGINT (Ctrl-C in dev).
// 1. Stop accepting new connections.
// 2. Wait for in-flight requests to finish (10-second hard deadline).
// 3. Close the DB pool so Postgres connections are released cleanly.
// 4. Exit 0 — anything that throws falls through to exit 1.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received — draining connections");

  // Prevent duplicate handling
  process.off("SIGTERM", onSigterm);
  process.off("SIGINT", onSigint);

  const deadline = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000);
  deadline.unref(); // don't keep the event loop alive just for the timeout

  try {
    // Stop background timers/schedulers first so they don't touch the DB mid-drain
    startupHandles?.stopAll();

    // Stop accepting new HTTP/WebSocket connections
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve())),
    );
    logger.info("HTTP server closed");

    // Release Postgres connection pool
    const { db } = await import("@workspace/db");
    if (typeof (db as any).$client?.end === "function") {
      await (db as any).$client.end();
      logger.info("Database pool closed");
    }
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
  } finally {
    clearTimeout(deadline);
    logger.info("Shutdown complete");
    process.exit(0);
  }
}

function onSigterm() { shutdown("SIGTERM").catch(() => process.exit(1)); }
function onSigint()  { shutdown("SIGINT").catch(() => process.exit(1)); }

// ── Runtime environment validation ────────────────────────────────────────────
// Critical secrets — always fail-fast if missing (no dev/prod distinction).
// Optional vars — warn only, never crash.
(function validateEnv() {
  // ── FAIL-FAST secrets — always exit immediately if missing ─────────────────
  const criticalErrors: string[] = [];

  if (!process.env.JWT_SECRET) {
    criticalErrors.push("JWT_SECRET is not set");
  }

  if (!process.env.REFRESH_TOKEN_SECRET) {
    criticalErrors.push("REFRESH_TOKEN_SECRET is not set");
  }

  if (criticalErrors.length > 0) {
    console.error("");
    console.error("╔══════════════════════════════════════════════════════════════╗");
    console.error("║  FATAL: Critical environment variables are not set           ║");
    console.error("╠══════════════════════════════════════════════════════════════╣");
    criticalErrors.forEach(e => console.error(`║  ✗ ${e.padEnd(58)}║`));
    console.error("╠══════════════════════════════════════════════════════════════╣");
    console.error("║  Generate secrets:                                           ║");
    console.error("║  node -e \"console.log(require('crypto')                       ║");
    console.error("║           .randomBytes(64).toString('hex'))\"                  ║");
    console.error("╚══════════════════════════════════════════════════════════════╝");
    console.error("");
    process.exit(1);
  }

  // ── Soft warnings (missing = degraded functionality, not crash) ────────────
  const softChecks: Array<{ key: string; label: string }> = [
    { key: "OPENROUTER_API_KEY", label: "Document AI Analysis will be unavailable" },
    { key: "RESEND_API_KEY",     label: "Email notifications will be silently skipped" },
    { key: "FROM_EMAIL",         label: "Emails will be sent from Resend sandbox address" },
    { key: "APP_URL",            label: "Email links will not resolve correctly" },
    { key: "ALLOWED_ORIGINS",    label: "CORS may be misconfigured for production" },
  ];

  if (process.env.NODE_ENV === "production") {
    const missing = softChecks.filter(c => !process.env[c.key]);
    if (missing.length > 0) {
      console.warn("[Config] The following optional env vars are not set:");
      missing.forEach(c => console.warn(`  ⚠  ${c.key}: ${c.label}`));
    }
  }
})();

// ── Storage configuration validation ──────────────────────────────────────────
// Resolves effective storage mode, auto-creates directories, and logs a clear
// summary so operators can verify the setup at a glance.
validateStorageAtStartup();

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wrap Express in a plain HTTP server so Socket.io can share the same port
const server = createServer(app);

initSocket(server);

// Critical startup MUST complete before the server accepts requests. If a fatal
// step (integrity migrations, RLS) fails, we refuse to listen and exit non-zero
// so a broken instance never serves traffic.
runCriticalStartup()
  .then(() => {
    server.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening (HTTP + WebSocket)");

      // Register graceful-shutdown handlers after the server is up
      process.on("SIGTERM", onSigterm);
      process.on("SIGINT",  onSigint);

      // Start background timers/schedulers only after critical init succeeded.
      startupHandles = startBackgroundJobs();

      startNotificationScheduler();
      startTrialDowngradeScheduler();
      // Seed AI routing defaults into system_settings (ON CONFLICT DO NOTHING — safe every boot).
      // Look for "[seed-ai-settings] AI routing defaults seeded" in your logs.
      seedAISettings().catch(() => {});
      seedSecuritySettings().catch(() => {});
      // Log resolved AI config AFTER seeding so the log reflects the DB values.
      // Look for "[AI] ═══ startup config resolved ═══" in your logs.
      logAIConfigAtStartup().catch(() => {});
    });
  })
  .catch((err) => {
    logger.fatal({ err }, "Critical startup failed — refusing to start the server");
    process.exit(1);
  });
