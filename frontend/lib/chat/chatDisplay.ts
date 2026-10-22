/** Shared, pure helpers for rendering a conversation/participant - used by the chat page and the group settings modal alike. */

export type ChatUser = { id?: string; name?: string | null; image?: string | null };
export type ChatParticipant = {
  userId: string;
  state?: string;
  role?: string;
  user?: ChatUser;
  notificationLevel?: string | null;
  mutedUntil?: string | null;
  isMuted?: boolean | null;
  isBlockedByMe?: boolean;
};
export type ChatConversation = {
  id: string;
  type?: string;
  title?: string | null;
  participants: ChatParticipant[];
};

function asConversation(value: unknown): ChatConversation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ChatConversation>;
  return Array.isArray(candidate.participants) ? (candidate as ChatConversation) : undefined;
}

export function conversationPeer(conversation: unknown, userId?: string) {
  return asConversation(conversation)?.participants.find(
    (participant) => participant.userId !== userId,
  )?.user;
}

export function activeMembers(conversation: unknown): ChatParticipant[] {
  return (asConversation(conversation)?.participants || []).filter(
    (participant) => participant.state === "ACTIVE",
  );
}

/** Active members other than `userId` - who this device's MLS group needs to include. */
export function otherActiveMemberIds(conversation: unknown, userId?: string): string[] {
  return activeMembers(conversation)
    .filter((participant) => participant.userId !== userId)
    .map((participant) => participant.userId);
}

export function participantUser(conversation: unknown, userId?: string) {
  return asConversation(conversation)?.participants.find(
    (participant) => participant.userId === userId,
  )?.user;
}

export function myParticipant(conversation: unknown, userId?: string) {
  return asConversation(conversation)?.participants.find(
    (participant) => participant.userId === userId,
  );
}

/** Whether you muted this conversation (the backend decides, including expiry), and until when; null = until you turn it back on. */
export function conversationMute(conversation: unknown, userId?: string) {
  const mine = myParticipant(conversation, userId);
  return { isMuted: Boolean(mine?.isMuted), mutedUntil: mine?.mutedUntil ?? null };
}

export function conversationDisplayName(conversation: unknown, userId?: string): string {
  const value = asConversation(conversation);
  if (value?.type === "GROUP") return value.title || "Group chat";
  return conversationPeer(conversation, userId)?.name || "GachaHub member";
}

/** The peer's picture for a direct chat; groups have none. */
export function conversationImage(conversation: unknown, userId?: string): string | null {
  if (asConversation(conversation)?.type === "GROUP") return null;
  return conversationPeer(conversation, userId)?.image ?? null;
}

export function initialOf(name?: string | null): string {
  return name?.trim()?.charAt(0).toUpperCase() || "?";
}

/** "Mado is typing...", "Mado and Rover are typing...", "Mado and 2 others are typing..." */
export function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]} and ${names.length - 1} others are typing...`;
}

/** In a direct chat, the other person when you have blocked them; otherwise null. Groups are never blocked as a whole. */
export function blockedPeerOf(conversation: unknown, userId?: string): ChatParticipant | null {
  const current = asConversation(conversation);
  if (!current || current.type === "GROUP") return null;
  return (
    current.participants.find(
      (participant) => participant.userId !== userId && participant.isBlockedByMe,
    ) ?? null
  );
}
