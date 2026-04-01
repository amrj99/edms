/**
 * useRealtime — subscribes to Socket.io events and invalidates React Query
 * caches so the UI updates automatically without a page refresh.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "../lib/socket";

export interface RealtimeHandlers {
  /** Called when a new notification arrives for the current user. */
  onNotification?: (notification: any) => void;
  /** Called when a new chat message arrives in a group the user is watching. */
  onChatMessage?: (message: any) => void;
}

/**
 * Mount this hook once in the root layout (only when the user is logged in).
 * It connects to the WebSocket server and sets up listeners for real-time events.
 */
export function useRealtime(handlers?: RealtimeHandlers) {
  const queryClient = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNotification = (notification: any) => {
      // Invalidate notifications list so the bell badge refreshes
      queryClient.invalidateQueries({ queryKey: ["listNotifications"] });
      queryClient.invalidateQueries({ queryKey: ["getNotificationCounts"] });
      handlersRef.current?.onNotification?.(notification);
    };

    const handleChatMessage = (message: any) => {
      // Invalidate messages for the group so the chat window refreshes
      if (message?.groupId) {
        queryClient.invalidateQueries({ queryKey: ["listChatMessages", message.groupId] });
      }
      // Also refresh unread counts
      queryClient.invalidateQueries({ queryKey: ["getChatUnreadCount"] });
      handlersRef.current?.onChatMessage?.(message);
    };

    socket.on("notification:new", handleNotification);
    socket.on("chat:message", handleChatMessage);

    return () => {
      socket.off("notification:new", handleNotification);
      socket.off("chat:message", handleChatMessage);
    };
  }, [queryClient]);
}

/**
 * Join a chat group room so the server sends real-time messages for that group.
 * Automatically leaves when the component unmounts.
 */
export function useChatGroupSocket(groupId: number | null | undefined) {
  useEffect(() => {
    if (!groupId) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit("join:chat", groupId);
    return () => {
      socket.emit("leave:chat", groupId);
    };
  }, [groupId]);
}
