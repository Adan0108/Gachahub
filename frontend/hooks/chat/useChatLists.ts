"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../../lib/queries";
import type { ChatConversation } from "../../lib/chat/chatDisplay";
import { useOlderInbox } from "./useOlderInbox";

export type ChatListConversation = ChatConversation & {
  lastMessage?: { id: string; senderId: string; status?: string; createdAt: string } | null;
  unreadCount?: number;
  updatedAt?: string;
  pinnedAt?: string | null;
};

export type ChatListView = "inbox" | "requests" | "archived" | "blocked";

/**
 * The chat sidebar's lists: the inbox (its first page, then older pages on request), requests,
 * archived chats and blocked people, and which of them the current view shows.
 */
export function useChatLists(view: ChatListView, isAuthenticated: boolean, userId?: string) {
  const conversations = useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
  const olderInbox = useOlderInbox(
    conversations.data as ChatListConversation[] | undefined,
    isAuthenticated,
  );
  // The inbox as loaded so far: its first page, then any older pages asked for.
  const inboxList = useMemo(
    () => [...((conversations.data ?? []) as ChatListConversation[]), ...olderInbox.conversations],
    [conversations.data, olderInbox.conversations],
  );
  const requests = useQuery({ ...queries.chatRequests(), enabled: isAuthenticated });
  const archived = useQuery({
    ...queries.chatArchivedConversations(),
    enabled: isAuthenticated && view === "archived",
  });
  const blockedUsers = useQuery({
    ...queries.chatBlockedUsers(),
    enabled: isAuthenticated && view === "blocked",
  });

  // The blocked view lists people, not conversations; the inbox stays the list behind it.
  const listByView = { inbox: conversations, requests, archived, blocked: conversations };
  const listQuery = listByView[view];
  const listData: ChatListConversation[] | undefined =
    view === "inbox" || view === "blocked" ? inboxList : listQuery.data;
  const directChatByUserId = new Map(
    inboxList
      .filter((conversation) => conversation.type === "DIRECT")
      .flatMap((conversation) =>
        conversation.participants
          .filter((participant) => participant.userId !== userId)
          .map((participant): [string, string] => [participant.userId, conversation.id]),
      ),
  );

  return {
    conversations,
    requests,
    archived,
    blockedUsers,
    olderInbox,
    listQuery,
    listData,
    directChatByUserId,
  };
}
