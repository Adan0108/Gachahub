"use client";

import { useEffect, useSyncExternalStore } from "react";
import { presenceStore } from "../../lib/presence/presenceStore";

/** ONLINE or OFFLINE for this person, or undefined until the server has answered. */
export function usePresenceOf(userId) {
  useEffect(() => {
    if (userId) presenceStore.request(userId);
  }, [userId]);

  return useSyncExternalStore(
    presenceStore.subscribe,
    () => (userId ? presenceStore.get(userId) : undefined),
    () => undefined,
  );
}
