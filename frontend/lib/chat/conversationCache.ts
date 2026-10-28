// Cached chat lists hold whatever the API returned; only these fields are read or rewritten.
type CachedParticipant = { userId: string; isBlockedByMe?: boolean };
type CachedConversation = { id: string; type?: string; participants: CachedParticipant[] };

/** The list without this conversation. */
export function withoutConversation<T>(list: T, conversationId: string): T {
  return Array.isArray(list)
    ? (list.filter((conversation: CachedConversation) => conversation.id !== conversationId) as T)
    : list;
}

/** In a direct chat, the other person's row is marked blocked by you (or not). */
export function withBlockedChat<T>(list: T, conversationId: string, userId: string, blocked: boolean): T {
  if (!Array.isArray(list)) return list;
  return list.map((conversation: CachedConversation) =>
    conversation.id === conversationId && conversation.type !== "GROUP"
      ? {
          ...conversation,
          participants: conversation.participants.map((participant) =>
            participant.userId === userId
              ? { ...participant, isBlockedByMe: blocked }
              : participant,
          ),
        }
      : conversation,
  ) as T;
}

/** Everywhere this person appears, marked blocked by you (or not): the id is theirs, not a conversation's. */
export function withBlockedPerson<T>(list: T, personId: string, blocked: boolean): T {
  if (!Array.isArray(list)) return list;
  return list.map((conversation: CachedConversation) =>
    conversation.type === "GROUP"
      ? conversation
      : {
          ...conversation,
          participants: conversation.participants.map((participant) =>
            participant.userId === personId
              ? { ...participant, isBlockedByMe: blocked }
              : participant,
          ),
        },
  ) as T;
}

/** The other person of a direct chat, by conversation id. */
export function peerIdOf(list: unknown, conversationId: string, myId?: string): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const conversation = (list as CachedConversation[]).find((item) => item.id === conversationId);
  return conversation?.participants.find((participant) => participant.userId !== myId)?.userId;
}
