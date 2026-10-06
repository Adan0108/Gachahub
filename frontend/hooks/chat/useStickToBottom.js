"use client";

import { useCallback, useRef, useState } from "react";

// Further than this from the very bottom counts as "reading older messages": no following, arrow shown.
const NEAR_BOTTOM_PX = 48;

/**
 * Scroll behaviour for a chat message list: follow new content only while you're at the bottom,
 * and say when you aren't so a "jump to latest" button can show. Attach `onScroll` to the list.
 */
export function useStickToBottom(containerRef) {
  const nearBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback((event) => {
    const list = event.currentTarget;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setAtBottom(near);
  }, []);

  // Goes to the true end of the list (scrollHeight), not just to the last item, so its bottom padding is included.
  const scrollToBottom = useCallback(
    (behavior = "auto") => {
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

  return { onScroll, scrollToBottom, followIfNearBottom, showJumpToBottom: !atBottom };
}
