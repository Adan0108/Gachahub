import { queryKeys } from "../queries";

/**
 * Adds one message to a conversation's cached newest page. A page fetch already in flight
 * started before this message existed and would overwrite the cache without it, so it is
 * cancelled first; with no page cached yet, the page is fetched fresh instead.
 */
export async function addMessageToCache(queryClient, conversationId, message) {
  const queryKey = queryKeys.chatMessages(conversationId);
  await queryClient.cancelQueries({ queryKey });

  if (!queryClient.getQueryData(queryKey)) {
    await queryClient.invalidateQueries({ queryKey });
    return;
  }

  queryClient.setQueryData(queryKey, (old) =>
    old.items.some((item) => item.id === message.id) ? old : { ...old, items: [...old.items, message] },
  );
}
