"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject, UIEvent } from "react";

type RevealOptions = { gapPx: number; behavior?: ScrollBehavior; onlyIfAbove?: boolean };

// Further than this from the very bottom counts as "reading older messages": no following, arrow shown.
const NEAR_BOTTOM_PX = 48;

/**
 * Scroll behaviour for a chat message list: follow new content only while you're at the bottom,
 * and say when you aren't so a "jump to latest" button can show. Attach `onScroll` to the list.
 */
export function useStickToBottom(containerRef: RefObject<HTMLElement | null>) {
  const nearBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const list = event.currentTarget;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setAtBottom(near);
  }, []);

  // Goes to the true end of the list (scrollHeight), not just to the last item, so its bottom padding is included.
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const list = containerRef.current;
      if (!list) return;

      nearBottomRef.current = true;
      if (behavior === "smooth" && list.scrollTo) {
        list.scrollTo({ top: list.scrollHeight, behavior });
      } else {
        list.scrollTop = list.scrollHeight;
      }
    },
    [containerRef],
  );

  const followIfNearBottom = useCallback(() => {
    if (nearBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);

  /**
   * Scrolls so `element` sits `gapPx` below the top of the list, and stops following new content.
   * `onlyIfAbove` leaves the list alone when the element is already that low or lower.
   */
  const revealAtTop = useCallback(
    (
      element: HTMLElement,
      { gapPx, behavior = "auto", onlyIfAbove = false }: RevealOptions,
    ) => {
      const list = containerRef.current;
      if (!list) return;
      const offset = element.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (onlyIfAbove && offset >= gapPx) return;
      // Before the scroll event says so: a decrypt finishing this frame must not pull you back down.
      nearBottomRef.current = false;
      const top = list.scrollTop + offset - gapPx;
      if (list.scrollTo) list.scrollTo({ top, behavior });
      else list.scrollTop = top;
    },
    [containerRef],
  );

  return { onScroll, scrollToBottom, followIfNearBottom, revealAtTop, showJumpToBottom: !atBottom };
}
