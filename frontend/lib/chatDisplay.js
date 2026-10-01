/** Shared, pure helpers for rendering a conversation/participant - used by the chat page and the group settings modal alike. */

export function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  // Clamped at 0, not floored straight to hours - anything under an hour old used to always read
  // "1h ago" regardless of whether it was 1 minute or 59 minutes old.
  const minutes = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
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
