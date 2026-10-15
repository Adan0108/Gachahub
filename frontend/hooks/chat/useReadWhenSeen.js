"use client";

import { useEffect, useRef } from "react";

// A tall message that fills at least half the thread counts as seen even if it never gets half of itself in view.
const SEEN_RATIO = 0.5;

const rowOf = (messageId) => document.getElementById(`chat-message-${messageId}`);

/**
 * Reports a message as read only once it is actually on screen: its row is at least half visible
 * inside the thread while the tab is visible. `messageIds` are the messages from others, oldest
 * first; `onRead(id)` gets the newest one seen so far, and only ever moves forward.
 *
 * Scrolled up in the history, or in a background tab, a new message stays unread.
 */
export function useReadWhenSeen({ containerRef, conversationId, messageIds, onRead }) {
  const idsKey = messageIds.join(",");
  const reportedRef = useRef({ conversationId: null, id: null });
  // Always the latest callback, without making the observer below start over every render.
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  useEffect(() => {
    const container = containerRef.current;
    const ids = idsKey ? idsKey.split(",") : [];
    if (!container || ids.length === 0) return undefined;

    if (reportedRef.current.conversationId !== conversationId) {
      reportedRef.current = { conversationId, id: null };
    }
    const position = new Map(ids.map((id, index) => [id, index]));

    const report = (newestIndex) => {
      const reportedIndex = position.get(reportedRef.current.id) ?? -1;
      if (newestIndex <= reportedIndex) return;
      reportedRef.current = { conversationId, id: ids[newestIndex] };
      onReadRef.current(ids[newestIndex]);
    };

    // Old browsers without IntersectionObserver cannot tell what is on screen: read everything, as before.
    if (typeof IntersectionObserver === "undefined") {
      report(ids.length - 1);
      return undefined;
    }

    const onScreen = new Set();
    const evaluate = () => {
      if (document.visibilityState !== "visible") return;
      const newest = Math.max(-1, ...[...onScreen].map((id) => position.get(id)));
      if (newest >= 0) report(newest);
    };

    const idOfElement = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = idOfElement.get(entry.target);
          const rootHeight = entry.rootBounds?.height ?? container.clientHeight;
          const seen =
            entry.isIntersecting &&
            (entry.intersectionRatio >= SEEN_RATIO || entry.intersectionRect.height >= rootHeight * SEEN_RATIO);
          if (seen) onScreen.add(id);
          else onScreen.delete(id);
        }
        evaluate();
      },
      { root: container, threshold: [0, SEEN_RATIO, 1] },
    );

    for (const id of ids) {
      const row = rowOf(id);
      if (!row) continue;
      idOfElement.set(row, id);
      observer.observe(row);
    }

    document.addEventListener("visibilitychange", evaluate);
    return () => {
      document.removeEventListener("visibilitychange", evaluate);
      observer.disconnect();
    };
  }, [containerRef, conversationId, idsKey]);
}
