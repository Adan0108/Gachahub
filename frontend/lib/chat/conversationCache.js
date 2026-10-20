/** The list without this conversation. */
export function withoutConversation(list, conversationId) {
  return Array.isArray(list)
    ? list.filter((conversation) => conversation.id !== conversationId)
    : list;
}

/** In a direct chat, the other person's row is marked blocked by you (or not). */
export function withBlockedChat(list, conversationId, userId, blocked) {
  if (!Array.isArray(list)) return list;
  return list.map((conversation) =>
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
  );
}

/** Everywhere this person appears, marked blocked by you (or not): the id is theirs, not a conversation's. */
export function withBlockedPerson(list, personId, blocked) {
  if (!Array.isArray(list)) return list;
  return list.map((conversation) =>
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
  );
}

/** The other person of a direct chat, by conversation id. */
export function peerIdOf(list, conversationId, myId) {
  if (!Array.isArray(list)) return undefined;
  const conversation = list.find((item) => item.id === conversationId);
  return conversation?.participants.find((participant) => participant.userId !== myId)?.userId;
}
