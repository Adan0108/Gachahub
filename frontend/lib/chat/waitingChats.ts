import { conversationMute } from "./chatDisplay";

type ListedChat = { unreadCount?: number; participants?: unknown[] };

/** Chats with something unread (muted ones left out) plus every pending request: what the Messages tab shows. */
export function countWaitingChats(
  conversations: readonly ListedChat[] | undefined,
  requests: readonly unknown[] | undefined,
  userId: string | undefined,
): number {
  const unread = (conversations ?? []).filter(
    (chat) => (chat.unreadCount ?? 0) > 0 && !conversationMute(chat, userId).isMuted,
  ).length;
  return unread + (requests?.length ?? 0);
}
