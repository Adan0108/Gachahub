"use client";

import { useQuery } from "@tanstack/react-query";
import { queries } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";

/** The signed-in user's inbox conversations, shared with the chat page through the same query. */
export function useChatConversations() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
}
