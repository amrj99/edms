import { createServer } from "http";
import app from "./app.js";
import { initSocket } from "./lib/socket.js";
import { logger } from "./lib/logger.js";
import { startNotificationScheduler } from "./lib/notifications/scheduler.js";
import { validateStorageAtStartup } from "./lib/storageConfig.js";

const rawPort = process.env["PORT"];

// ── Runtime environment validation ────────────────────────────────────────────
// Critical secrets — fail-fast in production if missing or using defaults.
// Optional vars — warn only, never crash.
(function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";

  // ── FAIL-FAST secrets (missing/default in production = hard exit) ──────────
  const DEFAULT_JWT     = "edms-secret-key-change-in-production";
  const DEFAULT_REFRESH = "edms-refresh-key-change-in-production";

  const criticalErrors: string[] = [];

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT) {
    if (isProd) {
      criticalErrors.push("JWT_SECRET is missing or using the insecure default value");
    } else {
      console.warn("[Security] WARNING: JWT_SECRET not set — using insecure default (dev only).");
    }
  }

  if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET === DEFAULT_REFRESH) {
    if (isProd) {
      criticalErrors.push("REFRESH_TOKEN_SECRET is missing or using the insecure default value");
    } else {
      console.warn("[Security] WARNING: REFRESH_TOKEN_SECRET not set — using insecure default (dev only).");
    }
  }

  if (criticalErrors.length > 0) {
    console.error("");
    console.error("╔══════════════════════════════════════════════════════════════╗");
    console.error("║  FATAL: Critical environment variables are not set properly  ║");
    console.error("╠══════════════════════════════════════════════════════════════╣");
    criticalErrors.forEach(e => console.error(`║  ✗ ${e.padEnd(58)}║`));
    console.error("╠══════════════════════════════════════════════════════════════╣");
    console.error("║  Set these in /var/www/edms/.env and redeploy.               ║");
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

  if (isProd) {
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

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
  startNotificationScheduler();
});
