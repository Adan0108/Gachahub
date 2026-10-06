"use client";

import { useQuery } from "@tanstack/react-query";
import { participantUser } from "../../lib/chat/chatDisplay";
import { queryKeys } from "../../lib/queries";

/** Names of the other people typing in a conversation right now. */
export function useTypingNames(conversation, userId) {
  // Written only by useChatSocket's typing:start/typing:stop handlers - nothing here fetches it,
  // this just observes whatever is currently in the cache for this conversation.
  const typingUserIds = useQuery({
    queryKey: queryKeys.chatTyping(conversation?.id),
    queryFn: () => [],
    enabled: Boolean(conversation?.id),
    staleTime: Infinity,
  }).data;

  return (typingUserIds || [])
    .filter((id) => id !== userId)
    .map((id) => participantUser(conversation, id)?.name)
    .filter(Boolean);
}
