"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { applyMute } from "../../lib/chat/applyMute";
import { queryKeys } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";

/** Mute or unmute one conversation: the list updates at once, rolls back if the server refuses, then syncs. */
export function useConversationMute(conversationId) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    // `change` is { notificationLevel: "ALL" | "NOTHING", mutedUntil?: ISO string }.
    mutationFn: (change) => api.setChatNotificationLevel(conversationId, change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chatConversations });
      const previous = queryClient.getQueryData(queryKeys.chatConversations);
      queryClient.setQueryData(queryKeys.chatConversations, (list) =>
        applyMute(list, conversationId, user?.id, change),
      );
      return { previous };
    },
    onError: (_error, _change, context) =>
      queryClient.setQueryData(queryKeys.chatConversations, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations }),
  });
}
