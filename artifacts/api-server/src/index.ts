import { createServer } from "http";
import app from "./app.js";
import { initSocket } from "./lib/socket.js";
import { logger } from "./lib/logger.js";
import { startNotificationScheduler } from "./lib/notifications/scheduler.js";

const rawPort = process.env["PORT"];

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
