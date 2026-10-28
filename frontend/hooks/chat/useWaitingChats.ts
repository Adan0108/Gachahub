"use client";

import { useQuery } from "@tanstack/react-query";
import { countWaitingChats } from "../../lib/chat/waitingChats";
import { queries } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";

/** How many chats and requests are waiting; kept live by the same socket refetches the chat page relies on. */
export function useWaitingChats(): number {
  const { user, isAuthenticated } = useCurrentUser();
  const conversations = useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
  const requests = useQuery({ ...queries.chatRequests(), enabled: isAuthenticated });

  return countWaitingChats(conversations.data as never, requests.data as never, user?.id);
}
