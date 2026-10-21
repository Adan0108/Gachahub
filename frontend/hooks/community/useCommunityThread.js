"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildRows } from "../../lib/community/communityChat";
import { useStickToBottom } from "../chat/useStickToBottom";
import { useNowTick } from "../useNowTick";

const MARK_READ_DELAY_MS = 800;
const NOW_TICK_MS = 30_000;
const FLASH_MS = 1600;
// Older pages loaded while looking for a message someone linked to
const MAX_FOCUS_PAGES = 6;

/**
 * How the message list behaves on screen: where it scrolls, when messages count as read, and the
 * reply and remove-confirmation state around it. The data itself comes from useCommunityChat.
 */
export function useCommunityThread(chat, focusMessageId) {
  const now = useNowTick(NOW_TICK_MS);
  const listElement = useRef(null);
  // A callback ref keeps the element itself out of what this hook hands back.
  const listRef = useCallback((node) => {
    listElement.current = node;
  }, []);
  const { onScroll, scrollToBottom, followIfNearBottom, showJumpToBottom } =
    useStickToBottom(listElement);
  const [replyTo, setReplyTo] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const heightBeforeOlder = useRef(null);

  const { messages, pending, markRead, isLoading, channel } = chat;
  const rows = buildRows(messages, { now: new Date(now) });
  const newestId = messages.at(-1)?.id;
  const oldestId = messages[0]?.id;

  // Open at the newest message; afterwards only follow when you are already at the bottom.
  const ready = !isLoading && Boolean(channel);
  useLayoutEffect(() => {
    if (ready) scrollToBottom();
  }, [ready, scrollToBottom]);
  useEffect(() => {
    followIfNearBottom();
  }, [newestId, pending.length, followIfNearBottom]);

  // Older messages are added above: keep what you were reading where it was.
  useLayoutEffect(() => {
    const list = listElement.current;
    if (list && heightBeforeOlder.current !== null) {
      list.scrollTop += list.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    }
  }, [oldestId]);

  // Seen once it is on screen for a moment, not merely loaded.
  useEffect(() => {
    if (!newestId || showJumpToBottom) return undefined;
    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") markRead(newestId);
    }, MARK_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [newestId, showJumpToBottom, markRead]);

  const loadOlder = () => {
    heightBeforeOlder.current = listElement.current?.scrollHeight ?? null;
    chat.loadOlder();
  };

  const jumpTo = (messageId) => {
    const element = document.getElementById(`community-message-${messageId}`);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("flash");
    setTimeout(() => element.classList.remove("flash"), FLASH_MS);
  };

  // Opened from a link to one message (a mention): scroll to it, loading older history while it is not there yet.
  const focusedRef = useRef(null);
  const focusPagesRef = useRef(0);
  const olderPending = chat.isLoadingOlder;
  const hasOlder = chat.hasOlder;
  const loadOlderForFocus = chat.loadOlder;
  useEffect(() => {
    if (!focusMessageId || !ready || focusedRef.current === focusMessageId) return;
    if (document.getElementById(`community-message-${focusMessageId}`)) {
      focusedRef.current = focusMessageId;
      jumpTo(focusMessageId);
    } else if (hasOlder && !olderPending && focusPagesRef.current < MAX_FOCUS_PAGES) {
      focusPagesRef.current += 1;
      loadOlderForFocus();
    } else if (!hasOlder || focusPagesRef.current >= MAX_FOCUS_PAGES) {
      focusedRef.current = focusMessageId;
    }
  }, [focusMessageId, ready, messages.length, hasOlder, olderPending, loadOlderForFocus]);

  const send = (content, files = []) => {
    chat.send(content, replyTo, files);
    setReplyTo(null);
  };

  const confirmRemove = () =>
    chat.remove.mutate({ messageId: removeTarget.id }, { onSuccess: () => setRemoveTarget(null) });

  const closeRemove = () => {
    chat.remove.reset();
    setRemoveTarget(null);
  };

  return {
    now,
    rows,
    listRef,
    onScroll,
    scrollToBottom,
    showJumpToBottom,
    loadOlder,
    jumpTo,
    replyTo,
    setReplyTo,
    send,
    removeTarget,
    setRemoveTarget,
    confirmRemove,
    closeRemove,
  };
}
