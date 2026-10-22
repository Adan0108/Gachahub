import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries";
import { compareMessages, type HistoryMessage } from "./chatHistory";

/**
 * Adds one message to a conversation's cached newest page. A page fetch already in flight
 * started before this message existed and would overwrite the cache without it, so it is
 * cancelled first; with no page cached yet, the page is fetched fresh instead. It goes where the
 * server's order puts it, not just at the end: pushes can arrive out of order.
 */
export async function addMessageToCache<Message extends HistoryMessage>(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
) {
  const queryKey = queryKeys.chatMessages(conversationId);
  await queryClient.cancelQueries({ queryKey });

  if (!queryClient.getQueryData(queryKey)) {
    await queryClient.invalidateQueries({ queryKey });
    return;
  }

  queryClient.setQueryData<{ items: Message[] }>(queryKey, (old) =>
    !old || old.items.some((item) => item.id === message.id)
      ? old
      : { ...old, items: [...old.items, message].sort(compareMessages) },
  );
}
