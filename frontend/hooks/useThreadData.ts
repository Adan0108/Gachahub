"use client";

import { useMemo } from "react";
import { useConversationHistory } from "./useConversationHistory";
import { useDecryptedMessages } from "./useDecryptedMessages";
import { useGroupProblem } from "./useGroupProblem";
import { useMembershipEvents } from "./useMembershipEvents";
import { useNewMessageAnnouncement } from "./useNewMessageAnnouncement";
import { useSafetyNumbers } from "./useSafetyNumbers";
import { otherActiveMemberIds, participantUser } from "../lib/chatDisplay";
import { buildThreadItems } from "../lib/chatThread";

interface ThreadMessage {
  id: string;
  senderId: string;
  ciphertext: string;
  createdAt: string;
  contentType?: string;
}

interface NewestPage {
  items: ThreadMessage[];
  meta: { nextBeforeMessageId: string | null };
}

/** Everything the open thread renders: history, decryption, membership events, safety and rows. */
export function useThreadData(
  conversationId: string,
  newestPage: NewestPage | undefined,
  conversation: unknown,
  userId: string | undefined,
) {
  const history = useConversationHistory(conversationId, newestPage);
  const { displayMessages } = history;
  const decryptable = useMemo(
    () => displayMessages.filter((message) => message.contentType !== "SYSTEM"),
    [displayMessages],
  );
  const decrypted = useDecryptedMessages(conversationId, decryptable, userId);
  const groupProblem = useGroupProblem(conversationId);
  const safetyPeerIds: string[] = otherActiveMemberIds(conversation, userId);
  const safety = useSafetyNumbers(conversationId, userId, safetyPeerIds);
  const membershipEvents = useMembershipEvents(conversationId);
  const threadItems = useMemo(
    () =>
      buildThreadItems({
        messages: displayMessages,
        decrypted,
        events: membershipEvents,
        collapseLeading: !groupProblem,
      }),
    [displayMessages, decrypted, membershipEvents, groupProblem],
  );
  // Only what this device actually read is acknowledged: an undecryptable message was not delivered.
  const newestItems = newestPage?.items;
  const readableMessageIds = useMemo(
    () =>
      (newestItems ?? [])
        .filter((message) => message.senderId !== userId && decrypted[message.id]?.status === "ok")
        .map((message) => message.id),
    [newestItems, userId, decrypted],
  );
  const lastMessage = newestPage ? (displayMessages.at(-1) ?? null) : undefined;
  const announcement = useNewMessageAnnouncement(
    conversationId,
    lastMessage,
    userId,
    participantUser(conversation, lastMessage?.senderId)?.name || "GachaHub member",
  );

  return {
    ...history,
    decrypted,
    groupProblem,
    safety,
    safetyPeerIds,
    threadItems,
    readableMessageIds,
    announcement,
  };
}
