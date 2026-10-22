"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { applyMute } from "../../lib/chat/applyMute";
import { queryKeys } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";
import type { ChatConversation } from "../../lib/chat/chatDisplay";

type MuteChange = { notificationLevel: "ALL" | "NOTHING"; mutedUntil?: string | null };

/** Mute or unmute one conversation: the list updates at once, rolls back if the server refuses, then syncs. */
export function useConversationMute(conversationId: string) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    // `change` is { notificationLevel: "ALL" | "NOTHING", mutedUntil?: ISO string }.
    mutationFn: (change: MuteChange) => api.setChatNotificationLevel(conversationId, change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chatConversations });
      const previous = queryClient.getQueryData<ChatConversation[]>(queryKeys.chatConversations);
      queryClient.setQueryData<ChatConversation[]>(queryKeys.chatConversations, (list) =>
        user?.id ? applyMute(list, conversationId, user.id, change) : list,
      );
      return { previous };
    },
    onError: (_error, _change, context) =>
      queryClient.setQueryData(queryKeys.chatConversations, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations }),
  });
}
