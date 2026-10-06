"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

/** Block, archive, unarchive and delete for any chat in the list; each refreshes the lists, then tells onGone which chat left. */
export function useConversationActions({ onGone } = {}) {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chatRequests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chatArchivedConversations }),
    ]);

  const options = (mutationFn) => ({
    mutationFn,
    onSuccess: async (_result, conversationId) => {
      await refresh();
      onGone?.(conversationId);
    },
  });

  return {
    block: useMutation(options((conversationId) => api.blockChatConversation(conversationId))),
    archive: useMutation(options((conversationId) => api.archiveChatConversation(conversationId))),
    unarchive: useMutation(options((conversationId) => api.unarchiveChatConversation(conversationId))),
    remove: useMutation(options((conversationId) => api.deleteChatConversation(conversationId))),
  };
}
