"use client";

import { useMemo } from "react";
import { groupHitsByConversation } from "../../lib/chat/conversationSearch";
import { MIN_SEARCH_CHARS } from "../../lib/chat/searchFolding";
import { useMessageSearchIndex } from "./useMessageSearchIndex";

const NO_HITS = { terms: [], hits: [] };

/**
 * Messages matching `query`, grouped by conversation. Holds the message index for as long as the
 * component using it is mounted, so mount that only once a message search has been asked for.
 */
export function useSidebarMessageSearch(query, conversations) {
  const indexState = useMessageSearchIndex(true);
  const { index, version } = indexState;
  const isSearching = query.trim().length >= MIN_SEARCH_CHARS;

  // Matching depends only on the query and the index; `conversations` only labels the groups and changes on every inbox poll.
  const { terms, hits } = useMemo(
    () => (isSearching ? index.search(query) : NO_HITS),
    // version: the index changed (messages arrived, or it is still filling)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSearching, index, version, query],
  );
  const groups = useMemo(() => groupHitsByConversation(hits, conversations ?? []), [hits, conversations]);

  return { isSearching, indexState, terms, groups };
}
