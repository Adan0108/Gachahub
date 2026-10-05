import { useSyncExternalStore } from "react";

let current = null;
const subscribers = new Set();

/** Published by useAppSocket, which owns the connection; null while signed out. */
export function setSharedSocket(socket) {
  current = socket;
  subscribers.forEach((notify) => notify());
}

function subscribe(notify) {
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
