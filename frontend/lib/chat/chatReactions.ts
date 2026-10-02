export interface RawReaction {
  userId: string;
  emoji: string | null;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the current user is one of the people behind this emoji. */
  mine: boolean;
}

/** Reactions are plaintext (server-visible), unlike message content: grouped by emoji, own reaction first. */
export function groupReactions(
  reactions: RawReaction[] | undefined,
  currentUserId: string | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions ?? []) {
    if (!reaction.emoji) continue;
    const existing = groups.get(reaction.emoji);
    const mine = existing?.mine || reaction.userId === currentUserId;
    groups.set(reaction.emoji, {
      emoji: reaction.emoji,
      count: (existing?.count ?? 0) + 1,
      mine,
    });
  }
  return [...groups.values()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
}

/** Patches one message's own reaction into a cached message list, so the reactor sees it before the server round trip. `emoji: null` removes it - one reaction per user per message, same as the backend. */
export function withOptimisticReaction<M extends { id: string; reactions?: RawReaction[] }>(
  messages: M[],
  messageId: string,
  userId: string,
  emoji: string | null,
): M[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const withoutMine = (message.reactions ?? []).filter((reaction) => reaction.userId !== userId);
    return { ...message, reactions: emoji ? [...withoutMine, { userId, emoji }] : withoutMine };
  });
}
