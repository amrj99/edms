import { createServer } from "http";
import app from "./app.js";
import { initSocket } from "./lib/socket.js";
import { logger } from "./lib/logger.js";
import { startNotificationScheduler } from "./lib/notifications/scheduler.js";

const rawPort = process.env["PORT"];

// ── Security startup checks ────────────────────────────────────────────────────
const DEFAULT_JWT = "edms-secret-key-change-in-production";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT) {
  const msg = process.env.NODE_ENV === "production"
    ? "CRITICAL: JWT_SECRET is using the default insecure value. Set JWT_SECRET in your .env file immediately."
    : "WARNING: JWT_SECRET is not set. Using insecure default (acceptable for local dev only).";
  console.warn(`[Security] ${msg}`);
}
if (!process.env.OPENROUTER_API_KEY && process.env.NODE_ENV === "production") {
  console.warn("[AI] OPENROUTER_API_KEY is not set. Document AI Analysis will fail until this is configured.");
}

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
