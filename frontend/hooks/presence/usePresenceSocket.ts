"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { presenceStore, type PresenceStatus } from "../../lib/presence/presenceStore";
import { queryKeys } from "../../lib/queries";
import { useSharedSocket } from "../../lib/socket/sharedSocket";

// Must stay well under the server's window (70s) for a socket to count as here.
export const PRESENCE_PING_MS = 25_000;
// Live updates can be missed (a chat accepted after the first lookup, a dropped event), so everyone shown is asked about again now and then.
export const PRESENCE_REFRESH_MS = 30_000;

/**
 * Keeps this tab counted as online and presence live: pings the server while connected, applies
 * other people's changes, and mirrors your own choice made in another tab or ended by its timer.
 */
export function usePresenceSocket() {
  const socket = useSharedSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) {
      presenceStore.clear();
      return undefined;
    }

    const ping = () => {
      if (socket.connected) socket.emit("presence:ping");
    };
    const onUpdate = ({ userId, status }: { userId: string; status: PresenceStatus }) =>
      presenceStore.set(userId, status);
    const onSelf = (mine: unknown) => queryClient.setQueryData(queryKeys.myPresence, mine);
    const onConnect = () => {
      ping();
      presenceStore.refreshAll();
      queryClient.invalidateQueries({ queryKey: queryKeys.myPresence });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") presenceStore.refreshAll();
    };

    socket.on("presence:update", onUpdate);
    socket.on("presence:self", onSelf);
    socket.on("connect", onConnect);
    ping();
    const timer = setInterval(ping, PRESENCE_PING_MS);
    const refreshTimer = setInterval(refreshWhenVisible, PRESENCE_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      clearInterval(timer);
      clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      socket.off("presence:update", onUpdate);
      socket.off("presence:self", onSelf);
      socket.off("connect", onConnect);
    };
  }, [socket, queryClient]);
}
