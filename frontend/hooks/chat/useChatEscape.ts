"use client";

import { useEffect, useRef } from "react";

/**
 * Escape in an open chat, as in Discord: scrolled up, it takes you to the bottom; at the bottom, it
 * marks the chat read. A press something else handled (a menu, a dialog, an edit, the @ list) calls
 * preventDefault, and is left alone: it is checked once every listener has had its turn.
 */
export function useChatEscape({
  enabled,
  atBottom,
  scrollToBottom,
  markAllRead,
}: {
  enabled: boolean;
  atBottom: boolean;
  scrollToBottom: () => void;
  markAllRead: () => void;
}) {
  // The latest values, read when the key is pressed, so the listener is added once.
  const latest = useRef({ atBottom, scrollToBottom, markAllRead });
  useEffect(() => {
    latest.current = { atBottom, scrollToBottom, markAllRead };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // After this press has reached every other listener, some of them added after this one.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (event.defaultPrevented) return;
        if (latest.current.atBottom) latest.current.markAllRead();
        else latest.current.scrollToBottom();
      }, 0);
      timers.add(timer);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [enabled]);
}
