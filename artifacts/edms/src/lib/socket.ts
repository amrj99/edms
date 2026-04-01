/**
 * Socket.io client singleton
 * Connects once and reuses the same socket across the app.
 */
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function getBaseUrl(): string {
  const base = (import.meta as any).env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function getSocket(): Socket | null {
  const token = localStorage.getItem("edms_token");
  if (!token) return null;

  if (socket && socket.connected) return socket;

  // The API server sits behind Replit's path-prefix proxy at /api.
  // WebSocket upgrades fail through the HTTPS proxy (ws:// vs wss://) so we
  // use HTTP long-polling only, which is fully supported and reliable.
  socket = io({
    path: "/api/socket.io",
    auth: { token },
    withCredentials: true,
    transports: ["polling"],
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.debug("[socket] Connected:", socket?.id);
  });

  socket.on("connect_error", (err) => {
    console.debug("[socket] Connection error:", err.message);
  });

  socket.on("disconnect", (reason) => {
    console.debug("[socket] Disconnected:", reason);
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Re-authenticate after token refresh (e.g. login/logout). */
export function reconnectSocket(): void {
  disconnectSocket();
}

export type { Socket };
