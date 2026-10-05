"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveThreadHits, wrapPosition } from "../../lib/chat/searchResults";
import { MIN_SEARCH_CHARS } from "../../lib/chat/searchFolding";
import { useMessageSearchIndex } from "./useMessageSearchIndex";

const NO_RESULTS = { results: [], olderCount: 0, terms: [] };
const RESULTS_PAGE_SIZE = 30;

/**
 * The state behind searching one conversation: what is typed versus what the shown results are for
 * (only Enter searches), the results and which one you are on, how many are shown, and loading
 * older history until the matches (or a message to land on) are in the thread.
 * `history` is useConversationHistory's output; `targetMessageId` is a message to land on.
 */
export function useThreadMessageSearch({
  conversation,
  messagesById,
  hiddenMessageIds,
  history,
  onJump,
  initialQuery = "",
  targetMessageId = null,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [activeId, setActiveId] = useState(targetMessageId);
  const [targetId, setTargetId] = useState(targetMessageId);
  const [isLoadingToMatches, setIsLoadingToMatches] = useState(Boolean(targetMessageId));
  const jumpedToTarget = useRef(false);
  const indexState = useMessageSearchIndex(true);
  const { index, version } = indexState;
  const { hasMoreHistory, isLoadingOlder, loadOlderMessages } = history;

  const isSearching = submitted.length >= MIN_SEARCH_CHARS;
  const { results, olderCount, terms } = useMemo(() => {
    if (!isSearching) return NO_RESULTS;
    const found = index.search(submitted, { conversationId: conversation.id });
    return { ...resolveThreadHits(found.hits, messagesById, hiddenMessageIds), terms: found.terms };
    // version: the index changed (messages arrived, or it is still filling)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, version, submitted, isSearching, conversation.id, messagesById, hiddenMessageIds]);

  const isWaitingForTarget = Boolean(targetId) && !messagesById.has(targetId);
  const wantsOlder = isLoadingToMatches && hasMoreHistory && (targetId ? isWaitingForTarget : olderCount > 0);
  const canLoadNow = !isLoadingOlder && !history.isWaitingOnRateLimit && !history.historyError;

  useEffect(() => {
    if (wantsOlder && canLoadNow) loadOlderMessages();
  }, [wantsOlder, canLoadNow, loadOlderMessages]);

  useEffect(() => {
    if (!targetId || jumpedToTarget.current || !results.some((result) => result.messageId === targetId)) return;
    jumpedToTarget.current = true;
    onJump(targetId);
  }, [targetId, results, onJump]);

  const typed = query.trim();
  const activePosition = results.findIndex((result) => result.messageId === activeId);
  // Stepping to a result further down the list opens the list up to it.
  const shownCount = Math.max(visibleCount, activePosition + 1);

  const startOver = (text) => {
    setSubmitted(text);
    setActiveId(null);
    setTargetId(null);
    setIsLoadingToMatches(false);
    setVisibleCount(RESULTS_PAGE_SIZE);
  };

  const goTo = (position) => {
    if (results.length === 0) return;
    const next = results[wrapPosition(position, results.length)];
    setActiveId(next.messageId);
    onJump(next.messageId);
  };

  /** One result on (+1) or back (-1); from nowhere, forward starts at the first and back at the last. */
  const step = (delta) => goTo((activePosition >= 0 ? activePosition : delta > 0 ? -1 : 0) + delta);

  return {
    query,
    typed,
    submitted,
    isStale: typed !== submitted,
    isSearching,
    indexState,
    results,
    shownResults: results.slice(0, shownCount),
    hasMoreResults: results.length > shownCount,
    showMoreResults: () => setVisibleCount(shownCount + RESULTS_PAGE_SIZE),
    olderCount,
    terms,
    activePosition,
    goTo,
    step,
    onQueryChange: (value) => {
      setQuery(value);
      if (!value.trim()) startOver("");
    },
    /** Enter: search what is typed, or, when it is already searched, step to the next result (Shift: previous). */
    onEnter: ({ shiftKey }) => {
      if (typed !== submitted) startOver(typed);
      else step(shiftKey ? -1 : 1);
    },
    older: {
      isLoading: isLoadingToMatches,
      wants: wantsOlder,
      start: () => setIsLoadingToMatches(true),
      stop: () => setIsLoadingToMatches(false),
    },
  };
}
