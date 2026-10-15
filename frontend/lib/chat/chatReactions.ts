/** A custom emote on the wire: mirrors PublicEmote in backend/src/chat/chat-emotes.service.ts, field for field. */
export interface ChatEmote {
  id: string;
  shortcode: string;
  unicode: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  /** Only present when seen through a reaction: removed since it was used, the reaction stays. */
  deletedAt?: string | null;
}

/** A reaction as the server sends it: an emoji, or an emote with its details. */
export interface RawReaction {
  userId: string;
  emoji: string | null;
  emoteId?: string | null;
  emote?: ChatEmote | null;
}

/** What someone reacted with. A new kind of reaction is one more member here and one more case where it is drawn. */
export type ReactionChoice = { kind: "emoji"; emoji: string } | { kind: "emote"; emote: ChatEmote };

export interface ReactionGroup {
  /** Stable across renders, and different between an emoji and an emote, for React keys. */
  key: string;
  choice: ReactionChoice;
  count: number;
  /** Whether the current user is one of the people behind this reaction. */
  mine: boolean;
}

export function choiceKey(choice: ReactionChoice): string {
  return choice.kind === "emoji" ? `emoji:${choice.emoji}` : `emote:${choice.emote.id}`;
}

/** The choice a server reaction stands for; null when it carries nothing that can be drawn. */
function choiceFromReaction(reaction: RawReaction): ReactionChoice | null {
  if (reaction.emoji) return { kind: "emoji", emoji: reaction.emoji };
  if (reaction.emote) return { kind: "emote", emote: reaction.emote };
  return null;
}

function reactionFromChoice(userId: string, choice: ReactionChoice): RawReaction {
  return choice.kind === "emoji"
    ? { userId, emoji: choice.emoji }
    : { userId, emoji: null, emoteId: choice.emote.id, emote: choice.emote };
}

/** Reactions are plaintext (server-visible), unlike message content: grouped by what was used, own reaction first. */
export function groupReactions(
  reactions: RawReaction[] | undefined,
  currentUserId: string | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();

  for (const reaction of reactions ?? []) {
    const choice = choiceFromReaction(reaction);
    if (!choice) continue;

    const key = choiceKey(choice);
    const existing = groups.get(key);
    groups.set(key, {
      key,
      choice: existing?.choice ?? choice,
      count: (existing?.count ?? 0) + 1,
      mine: Boolean(existing?.mine) || reaction.userId === currentUserId,
    });
  }

  return [...groups.values()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
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
    const reactions = choice ? [...withoutMine, reactionFromChoice(userId, choice)] : withoutMine;
    return { ...message, reactions };
  });
}
