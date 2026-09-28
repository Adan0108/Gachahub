"use client";

import { useMemo } from "react";
import { useConversationHistory } from "./useConversationHistory";
import { useDecryptedMessages } from "./useDecryptedMessages";
import { useGroupProblem } from "./useGroupProblem";
import { useMembershipEvents } from "./useMembershipEvents";
import { useNewMessageAnnouncement } from "./useNewMessageAnnouncement";
import { useNowTick } from "./useNowTick";
import { useSafetyNumbers } from "./useSafetyNumbers";
import { otherActiveMemberIds, participantUser } from "../lib/chatDisplay";
import { buildThreadItems, eventsForDisplay } from "../lib/chatThread";

interface ThreadMessage {
  id: string;
  senderId: string;
  ciphertext: string;
  createdAt: string;
  contentType?: string;
  status?: string;
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
    () =>
      displayMessages.filter(
        (message) => message.contentType !== "SYSTEM" && message.status !== "DELETED",
      ),
    [displayMessages],
  );
  const decrypted = useDecryptedMessages(conversationId, decryptable, userId);
  const groupProblem = useGroupProblem(conversationId);
  const safetyPeerIds: string[] = otherActiveMemberIds(conversation, userId);
  const safety = useSafetyNumbers(conversationId, userId, safetyPeerIds);
  const rawMembershipEvents = useMembershipEvents(conversationId);
  const isGroup = (conversation as { type?: string } | undefined)?.type === "GROUP";
  const membershipEvents = useMemo(
    () => eventsForDisplay(rawMembershipEvents, isGroup),
    [isGroup, rawMembershipEvents],
  );
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

  // Coarse tick: only timestamp-divider text needs to react to time passing, not the item list itself.
  const now = useNowTick(60_000);

  return {
    ...history,
    decrypted,
    groupProblem,
    safety,
    safetyPeerIds,
    threadItems,
    readableMessageIds,
    announcement,
    now,
  };
}
