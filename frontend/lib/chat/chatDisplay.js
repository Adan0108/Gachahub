/** Shared, pure helpers for rendering a conversation/participant - used by the chat page and the group settings modal alike. */

export function conversationPeer(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId !== userId)?.user;
}

export function activeMembers(conversation) {
  return (conversation?.participants || []).filter((participant) => participant.state === "ACTIVE");
}

/** Active members other than `userId` - who this device's MLS group needs to include. */
export function otherActiveMemberIds(conversation, userId) {
  return activeMembers(conversation)
    .filter((participant) => participant.userId !== userId)
    .map((participant) => participant.userId);
}

export function participantUser(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId === userId)?.user;
}

export function myParticipant(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId === userId);
}

/** Whether you muted this conversation (the backend decides, including expiry), and until when; null = until you turn it back on. */
export function conversationMute(conversation, userId) {
  const mine = myParticipant(conversation, userId);
  return { isMuted: Boolean(mine?.isMuted), mutedUntil: mine?.mutedUntil ?? null };
}

export function conversationDisplayName(conversation, userId) {
  if (conversation?.type === "GROUP") return conversation.title || "Group chat";
  return conversationPeer(conversation, userId)?.name || "GachaHub member";
}

/** The peer's picture for a direct chat; groups have none. */
export function conversationImage(conversation, userId) {
  if (conversation?.type === "GROUP") return null;
  return conversationPeer(conversation, userId)?.image ?? null;
}

export function initialOf(name) {
  return name?.trim()?.charAt(0).toUpperCase() || "?";
}

/** "Mado is typing...", "Mado and Rover are typing...", "Mado and 2 others are typing..." */
export function typingLabel(names) {
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]} and ${names.length - 1} others are typing...`;
}
