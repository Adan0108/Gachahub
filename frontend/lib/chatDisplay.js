/** Shared, pure helpers for rendering a conversation/participant - used by the chat page and the group settings modal alike. */

export function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  const hours = Math.max(1, Math.floor((Date.now() - date.valueOf()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

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

export function conversationDisplayName(conversation, userId) {
  if (conversation?.type === "GROUP") return conversation.title || "Group chat";
  return conversationPeer(conversation, userId)?.name || "GachaHub member";
}

export function initialOf(name) {
  return name?.trim()?.charAt(0).toUpperCase() || "?";
}
