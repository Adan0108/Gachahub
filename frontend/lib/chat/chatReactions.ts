/** A custom emote as the server describes it on a reaction or in the picker. */
export interface ChatEmote {
  id: string;
  shortcode: string;
  unicode?: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  width?: number | null;
  height?: number | null;
  /** Set when the emote has been removed since it was used; the reaction stays. */
  deletedAt?: string | null;
}

export interface RawReaction {
  userId: string;
  emoji: string | null;
  emoteId?: string | null;
  emote?: ChatEmote | null;
}

/** What someone reacted with: a unicode emoji, or one of a game's or the app's custom emotes. */
export type ReactionChoice = { emoji: string } | { emoteId: string; emote: ChatEmote };

export interface ReactionGroup {
  /** Stable across renders and between an emoji and an emote, for React keys. */
  key: string;
  emoji: string | null;
  emote: ChatEmote | null;
  count: number;
  /** Whether the current user is one of the people behind this reaction. */
  mine: boolean;
}

export function isEmoteChoice(
  choice: ReactionChoice,
): choice is { emoteId: string; emote: ChatEmote } {
  return "emoteId" in choice;
}

function keyOf(reaction: RawReaction): string | null {
  if (reaction.emoji) return `emoji:${reaction.emoji}`;
  if (reaction.emoteId) return `emote:${reaction.emoteId}`;
  return null;
}

/** Reactions are plaintext (server-visible), unlike message content: grouped by what was used, own reaction first. */
export function groupReactions(
  reactions: RawReaction[] | undefined,
  currentUserId: string | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();

  for (const reaction of reactions ?? []) {
    const key = keyOf(reaction);
    if (!key) continue;

    const existing = groups.get(key);
    groups.set(key, {
      key,
      emoji: reaction.emoji || null,
      emote: reaction.emote ?? existing?.emote ?? null,
      count: (existing?.count ?? 0) + 1,
      mine: Boolean(existing?.mine) || reaction.userId === currentUserId,
    });
  }

  return [...groups.values()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
}

/** The reaction a chip stands for, to send it again or to take it back. */
export function choiceOf(group: ReactionGroup): ReactionChoice | null {
  if (group.emoji) return { emoji: group.emoji };
  if (group.emote) return { emoteId: group.emote.id, emote: group.emote };
  return null;
}

/** Patches one message's own reaction into a cached message list, so the reactor sees it before the server round trip. `null` removes it - one reaction per user per message, same as the backend. */
export function withOptimisticReaction<M extends { id: string; reactions?: RawReaction[] }>(
  messages: M[],
  messageId: string,
  userId: string,
  choice: ReactionChoice | null,
): M[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;

    const withoutMine = (message.reactions ?? []).filter((reaction) => reaction.userId !== userId);
    if (!choice) return { ...message, reactions: withoutMine };

    const mine: RawReaction = isEmoteChoice(choice)
      ? { userId, emoji: null, emoteId: choice.emoteId, emote: choice.emote }
      : { userId, emoji: choice.emoji };
    return { ...message, reactions: [...withoutMine, mine] };
  });
}
