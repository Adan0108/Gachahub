"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

const clearUnread = (conversationId) => (list) =>
  Array.isArray(list)
    ? list.map((conversation) => (conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation))
    : list;

/**
 * Marks a conversation read up to a message. When that is the newest message the sidebar badge and
 * bold preview clear at once; the server's answer then settles the list and the notification bell.
 */
export function useMarkChatRead() {
  const queryClient = useQueryClient();

  return useCallback(
    async (conversationId, messageId, { isNewest }) => {
      if (isNewest) queryClient.setQueryData(queryKeys.chatConversations, clearUnread(conversationId));
      try {
        await api.markChatRead(conversationId, messageId);
      } catch {
        // Next refetch shows the true count.
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
    [queryClient],
  );
}
