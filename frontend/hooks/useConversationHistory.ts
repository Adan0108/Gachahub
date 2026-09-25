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
  /** Set when loading older history failed for a reason other than the rate limit. */
  historyError: Error | undefined;
  /** Clears historyError and tries the same batch again. */
  retryHistory: () => void;
  /** Attach to the scrollable message list. */
  containerRef: RefObject<HTMLDivElement | null>;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
}

/** Browsers with CSS scroll anchoring (overflow-anchor) keep the view steady on their own. */
const supportsScrollAnchoring = () =>
  typeof CSS !== "undefined" && CSS.supports?.("overflow-anchor", "auto");

/** Older messages not already shown, so a page fetched twice never repeats a message. */
function unseen<Message extends HistoryMessage>(incoming: Message[], ...shown: Message[][]) {
  const known = new Set(shown.flatMap((messages) => messages.map((message) => message.id)));
  return incoming.filter((message) => !known.has(message.id));
}

/** Scroll-back history over the caller's newest window: loads older batches near the top, holds scroll position, pauses on 429. */
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
  const [now, setNow] = useState(() => Date.now());
  const [historyError, setHistoryError] = useState<Error | undefined>();
  const [ownerId, setOwnerId] = useState(conversationId);
  const [previousLatest, setPreviousLatest] = useState<Message[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // A response only counts if the conversation is still the one it was requested for.
  const generation = useRef(0);
  const isFetching = useRef(false);

  useEffect(() => {
    generation.current += 1;
    isFetching.current = false;
  }, [conversationId]);

  const latest = useMemo(() => newestPage?.items ?? [], [newestPage?.items]);
  const hasMoreHistory = typeof nextBeforeMessageId === "string";

  if (conversationId !== ownerId) {
    setOwnerId(conversationId);
    setOlderMessages([]);
    setNextBeforeMessageId(undefined);
    setIsLoadingOlder(false);
    setRateLimit(null);
    setHistoryError(undefined);
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

  const fetchOlderMessages = async () => {
    if (isFetching.current || !hasMoreHistory || rateLimit) return;

    const requestGeneration = generation.current;
    const isCurrent = () => generation.current === requestGeneration;
    isFetching.current = true;
    setIsLoadingOlder(true);
    const container = containerRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    try {
      const page = (await api.getChatMessages(conversationId, {
        beforeMessageId: nextBeforeMessageId,
        limit: PAGE_SIZE,
      })) as MessagesPage<Message>;
      if (!isCurrent()) return;
      setOlderMessages((previous) => [...unseen(page.items, previous, latest), ...previous]);
      setNextBeforeMessageId(page.meta.nextBeforeMessageId);
      // Fallback for browsers without scroll anchoring: hold the content under the viewport.
      requestAnimationFrame(() => {
        if (container && !supportsScrollAnchoring()) container.scrollTop += container.scrollHeight - previousScrollHeight;
      });
    } catch (error) {
      if (!isCurrent()) return;
      const { status, retryAfterSeconds } = error as {
        status?: number;
        retryAfterSeconds?: number;
      };
      if (status === 429) {
        const startedAt = Date.now();
        setNow(startedAt);
        setRateLimit({
          resumesAt: startedAt + (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000,
        });
      } else {
        setHistoryError(error instanceof Error ? error : new Error('Could not load older messages'));
      }
    } finally {
      if (isCurrent()) {
        isFetching.current = false;
        setIsLoadingOlder(false);
      }
    }
  };

  // Scrolling never re-hits a failed request on its own; only retryHistory does.
  const loadOlderMessages = () => {
    if (!historyError) void fetchOlderMessages();
  };

  const retryHistory = () => {
    setHistoryError(undefined);
    void fetchOlderMessages();
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop < NEAR_TOP_PX) loadOlderMessages();
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
    if ((containerRef.current?.scrollTop ?? Infinity) < NEAR_TOP_PX) loadOlderMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-checks only when the ceiling clears or the conversation changes, not on every render
  }, [rateLimit, conversationId]);

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
    historyError,
    retryHistory,
    containerRef,
    handleScroll,
  };
}
