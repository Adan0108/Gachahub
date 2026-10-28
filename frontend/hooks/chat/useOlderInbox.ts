"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { INBOX_PAGE_SIZE, queries } from "../../lib/queries";

type InboxConversation = { id: string; updatedAt?: string; pinnedAt?: string | null };
type InboxCursor = { updatedAt: string; id: string };

/** Where the next page starts: after the last unpinned conversation, when that page was full. */
export function cursorAfter(page: readonly InboxConversation[] | undefined): InboxCursor | null {
  const unpinned = (page ?? []).filter((conversation) => !conversation.pinnedAt);
  const last = unpinned.at(-1);
  return unpinned.length >= INBOX_PAGE_SIZE && last?.updatedAt
    ? { updatedAt: last.updatedAt, id: last.id }
    : null;
}

/**
 * The inbox past its first page, loaded a page at a time on request. The first page stays the
 * plain list everything else reads and edits; this only adds what comes after it.
 */
export function useOlderInbox<Conversation extends InboxConversation>(
  firstPage: readonly Conversation[] | undefined,
  enabled: boolean,
) {
  const [requested, setRequested] = useState(false);
  const start = cursorAfter(firstPage);
  const older = useInfiniteQuery({
    ...queries.chatOlderConversations(start),
    enabled: enabled && requested && start !== null,
  });

  const conversations = useMemo(() => {
    // The first page is fresher: a conversation that moved up since is shown there, once.
    const shown = new Set((firstPage ?? []).map((conversation) => conversation.id));
    return (older.data?.pages ?? [])
      .flat()
      .filter((conversation) => !shown.has(conversation.id) && shown.add(conversation.id))
      .map((conversation) => conversation as Conversation);
  }, [firstPage, older.data]);

  const hasMore = start !== null && (!requested || older.hasNextPage);
  return {
    conversations,
    hasMore,
    isLoading: older.isFetching,
    loadMore: () => {
      if (!requested) setRequested(true);
      else if (older.hasNextPage && !older.isFetching) void older.fetchNextPage();
    },
  };
}
