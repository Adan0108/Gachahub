import { useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";

let current: Socket | null = null;
const subscribers = new Set<() => void>();

/** Published by useAppSocket, which owns the connection; null while signed out. */
export function setSharedSocket(socket: Socket | null) {
  current = socket;
  subscribers.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/** The app's one live socket, or null until it connects; each feature attaches only its own listeners. */
export function useSharedSocket() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
