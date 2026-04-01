/**
 * Socket.io real-time service
 * Provides in-app notifications, chat, and workflow updates without page refresh.
 */
import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyToken } from "./auth.js";
import { logger } from "./logger.js";

let io: SocketIOServer | null = null;

export function initSocket(server: HTTPServer): SocketIOServer {
  // In Replit's path-based proxy the API server is exposed at /api, so the
  // full external path for socket.io is /api/socket.io.  The frontend client
  // must use the same path so the proxy routes WS upgrade requests here.
  const socketPath = process.env.SOCKET_IO_PATH ?? "/api/socket.io";

  io = new SocketIOServer(server, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    path: socketPath,
  });

  logger.info({ socketPath }, "Socket.io path configured");

  // ─── Auth middleware ───────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("No token provided"));
      }

      const payload = verifyToken(token as string);
      if (!payload) {
        return next(new Error("Invalid token"));
      }

      (socket as any).user = payload;
      next();
    } catch {
      next(new Error("Authentication error"));
    }
  });

  // ─── Connection handler ────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const user = (socket as any).user;
    const userId: number = user.id;
    const orgId: number = user.organizationId;

    // Each user gets a private room; all users in the org share an org room
    socket.join(`user:${userId}`);
    if (orgId) socket.join(`org:${orgId}`);

    logger.debug({ userId, orgId }, "Socket connected");

    socket.on("disconnect", (reason) => {
      logger.debug({ userId, reason }, "Socket disconnected");
    });

    // Client can join a specific chat group room for real-time messages
    socket.on("join:chat", (groupId: number) => {
      socket.join(`chat:${groupId}`);
    });

    socket.on("leave:chat", (groupId: number) => {
      socket.leave(`chat:${groupId}`);
    });
  });

  logger.info("Socket.io initialized");
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

/** Push a real-time event to a single user. */
export function emitToUser(userId: number, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

/** Push a real-time event to all connected users in an organisation. */
export function emitToOrg(orgId: number, event: string, data: unknown): void {
  io?.to(`org:${orgId}`).emit(event, data);
}

/** Push a real-time message to everyone in a chat group room. */
export function emitToChatGroup(groupId: number, event: string, data: unknown): void {
  io?.to(`chat:${groupId}`).emit(event, data);
}
