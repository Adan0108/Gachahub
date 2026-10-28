"use client";

import { useEffect, useRef } from "react";
import { newLineElementId } from "../../lib/chat/unreadMarker";

/**
 * More unread than fits: a chat opens at its NEW line instead of the bottom, once per opening.
 * `rendered` changes as rows render, so the line is found as soon as it is drawn.
 */
export function useOpenAtLine({
  conversationId,
  lineId,
  rendered,
  revealAtTop,
  gapPx,
}: {
  conversationId: string;
  lineId: string | undefined;
  rendered: unknown;
  revealAtTop: (element: HTMLElement, options: { gapPx: number; onlyIfAbove: boolean }) => void;
  /** Room left above the line, so the bar over the thread does not cover it. */
  gapPx: number;
}) {
  // The opening already positioned: leaving and coming back positions again.
  const positioned = useRef<string | null>(null);
  useEffect(() => {
    positioned.current = null;
  }, [conversationId]);

  useEffect(() => {
    const key = `${conversationId}:${lineId}`;
    if (!lineId || positioned.current === key) return undefined;
    const row = document.getElementById(newLineElementId(lineId));
    if (!row) return undefined;
    positioned.current = key;
    // After this render's other effects, such as the scroll to the bottom on opening.
    const frame = requestAnimationFrame(() => {
      if (row.isConnected) revealAtTop(row, { gapPx, onlyIfAbove: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [conversationId, lineId, rendered, revealAtTop, gapPx]);
}
