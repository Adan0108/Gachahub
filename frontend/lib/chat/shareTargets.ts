import { conversationDisplayName, myParticipant, otherActiveMemberIds } from "./chatDisplay";
import type { ChatConversation } from "./chatDisplay";

export type ShareStatus = { ok: boolean; reason: string | null };
export type ShareTarget = ShareStatus & { conversation: ChatConversation; name: string };

/** Whether something can be sent into this conversation right now, and if not, why. */
export function shareStatus(conversation: ChatConversation, userId?: string): ShareStatus {
  if (myParticipant(conversation, userId)?.state !== "ACTIVE") {
    return { ok: false, reason: "You can't send here" };
  }
  if (otherActiveMemberIds(conversation, userId).length === 0) {
    return {
      ok: false,
      reason:
        conversation.type === "GROUP" ? "Nobody has joined yet" : "Waiting for them to accept",
    };
  }
  return { ok: true, reason: null };
}

/** The conversations to offer, narrowed by what was typed, each with whether it can be sent into. */
export function shareTargets(
  conversations: ChatConversation[] | null | undefined,
  userId?: string,
  query = "",
): ShareTarget[] {
  const needle = query.trim().toLowerCase();

  return (conversations || [])
    .map((conversation) => ({
      conversation,
      name: conversationDisplayName(conversation, userId),
      ...shareStatus(conversation, userId),
    }))
    .filter((target: ShareTarget) => !needle || target.name.toLowerCase().includes(needle));
}

/** The direct conversation with one person, wherever it sits (inbox, requests, archive), or undefined. */
export function directConversationWith(
  conversationLists: Array<ChatConversation[] | null | undefined>,
  peerId: string,
): ChatConversation | undefined {
  for (const list of conversationLists) {
    const found = (list || []).find(
      (conversation) =>
        conversation.type === "DIRECT" &&
        conversation.participants?.some((participant) => participant.userId === peerId),
    );
    if (found) return found;
  }
  return undefined;
}
