"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, UIEvent } from "react";
import { api } from "../lib/api";
import { messagesFallenOutOfWindow, type HistoryMessage } from "../lib/chatHistory";

const PAGE_SIZE = 50;
const NEAR_TOP_PX = 80;
const DEFAULT_RETRY_AFTER_SECONDS = 8;

interface MessagesPage<Message> {
  items: Message[];
  meta: { nextBeforeMessageId: string | null };
}

interface HistoryRateLimit {
  resumesAt: number;
}

export interface ConversationHistory<Message> {
  /** Older history loaded so far, followed by the newest window. */
  displayMessages: Message[];
  isLoadingOlder: boolean;
  /** Set while the server is making us wait between batches. */
  isWaitingOnRateLimit: boolean;
  rateLimitSecondsLeft: number;
  /** Attach to the scrollable message list. */
  containerRef: RefObject<HTMLDivElement | null>;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
}

/**
 * Scroll-back history for one conversation, layered over the newest-messages window the caller
 * already polls: older batches load as the user nears the top, the scroll position is held steady
 * as they are prepended, and a 429 from the server pauses loading with a countdown, then resumes
 * on its own if the user is still sitting at the top.
 *
 * The window shifts forward as messages arrive; anything that falls off its end is folded into the
 * older history instead of being lost (see messagesFallenOutOfWindow). Switching conversations
 * starts everything over - done by comparing against the last render rather than in an effect,
 * the pattern React recommends for deriving state from a changed input
 * (https://react.dev/learn/you-might-not-need-an-effect).
 */
export function useConversationHistory<Message extends HistoryMessage>(
  conversationId: string,
  newestPage: MessagesPage<Message> | undefined,
): ConversationHistory<Message> {
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  // undefined = first page hasn't loaded yet, null = no older history left, else the next cursor.
  const [nextBeforeMessageId, setNextBeforeMessageId] = useState<string | null | undefined>(
    undefined,
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [rateLimit, setRateLimit] = useState<HistoryRateLimit | null>(null);
  const [ownerId, setOwnerId] = useState(conversationId);
  const [previousLatest, setPreviousLatest] = useState<Message[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const latest = useMemo(() => newestPage?.items ?? [], [newestPage?.items]);
  const hasMoreHistory = typeof nextBeforeMessageId === "string";

  if (conversationId !== ownerId) {
    setOwnerId(conversationId);
    setOlderMessages([]);
    setNextBeforeMessageId(undefined);
    setIsLoadingOlder(false);
    setRateLimit(null);
    setPreviousLatest([]);
  } else if (latest !== previousLatest) {
    setPreviousLatest(latest);

    if (previousLatest.length === 0) {
      if (newestPage?.meta) setNextBeforeMessageId(newestPage.meta.nextBeforeMessageId);
    } else {
      const fallenOut = messagesFallenOutOfWindow(previousLatest, latest);
      if (fallenOut.length > 0) {
        setOlderMessages((previous) => [...previous, ...fallenOut]);
      }
    }
  }

  const loadOlderMessages = async () => {
    if (isLoadingOlder || !hasMoreHistory || rateLimit) return;

    setIsLoadingOlder(true);
    const container = containerRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    try {
      const page = (await api.getChatMessages(conversationId, {
        beforeMessageId: nextBeforeMessageId,
        limit: PAGE_SIZE,
      })) as MessagesPage<Message>;
      setOlderMessages((previous) => [...page.items, ...previous]);
      setNextBeforeMessageId(page.meta.nextBeforeMessageId);
      // Keep the same content under the viewport instead of jumping when older
      // messages are prepended above what the user was already looking at.
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - previousScrollHeight;
      });
    } catch (error) {
      const { status, retryAfterSeconds } = error as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (status === 429) {
        setRateLimit({
          resumesAt: Date.now() + (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000,
        });
      }
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop < NEAR_TOP_PX) void loadOlderMessages();
  };

  useEffect(() => {
    if (!rateLimit) return;
    const timer = setTimeout(
      () => setRateLimit(null),
      Math.max(rateLimit.resumesAt - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [rateLimit]);

  // Once the ceiling clears, keep going on its own if the user is still sitting at the top
  // waiting, instead of making them scroll again to resume.
  useEffect(() => {
    if (rateLimit || !hasMoreHistory || isLoadingOlder) return;
    if ((containerRef.current?.scrollTop ?? Infinity) < NEAR_TOP_PX) void loadOlderMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-checks only when the ceiling clears or the conversation changes, not on every render
  }, [rateLimit, conversationId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rateLimit) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [rateLimit]);

  const displayMessages = useMemo(() => [...olderMessages, ...latest], [olderMessages, latest]);

  return {
    displayMessages,
    isLoadingOlder,
    isWaitingOnRateLimit: rateLimit !== null,
    rateLimitSecondsLeft: rateLimit
      ? Math.max(0, Math.ceil((rateLimit.resumesAt - now) / 1000))
      : 0,
    containerRef,
    handleScroll,
  };
}
