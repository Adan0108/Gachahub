"use client";

import { useMemo } from "react";
import { useConversationHistory } from "./useConversationHistory";
import { useDecryptedMessages } from "./useDecryptedMessages";
import { useGroupProblem } from "./useGroupProblem";
import { useMembershipEvents } from "./useMembershipEvents";
import { useNewMessageAnnouncement } from "./useNewMessageAnnouncement";
import { useNowTick } from "../useNowTick";
import { useSafetyNumbers } from "./useSafetyNumbers";
import { otherActiveMemberIds, participantUser } from "../../lib/chat/chatDisplay";
import { buildThreadItems, eventsForDisplay, readableNeighbors } from "../../lib/chat/chatThread";
import { applyEdits, isEditMessage } from "../../lib/chat/messageEdits";

interface ThreadMessage {
  id: string;
  senderId: string;
  ciphertext: string;
  createdAt: string;
  contentType?: string;
  status?: string;
  editsMessageId?: string | null;
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
  // An unsent message takes its edits with it, so their cached text goes too.
  const deletedMessageIds = useMemo(() => {
    const unsent = new Set(
      displayMessages.filter((message) => message.status === "DELETED").map((message) => message.id),
    );
    return displayMessages
      .filter(
        (message) =>
          unsent.has(message.id) ||
          (isEditMessage(message) && message.editsMessageId && unsent.has(message.editsMessageId)),
      )
      .map((message) => message.id);
  }, [displayMessages]);
  const decryptedRaw = useDecryptedMessages(conversationId, decryptable, userId, deletedMessageIds);
  // Edits are hidden messages of their own: they change what the original says, but are never shown.
  const { decrypted, edited } = useMemo(
    () => applyEdits(displayMessages, decryptedRaw),
    [displayMessages, decryptedRaw],
  );
  const visibleMessages = useMemo(
    () => displayMessages.filter((message) => !isEditMessage(message)),
    [displayMessages],
  );
  // Built once per change instead of every row re-deriving its own O(n) lookups.
  const messagesById = useMemo(
    () => new Map(visibleMessages.map((message) => [message.id, message])),
    [visibleMessages],
  );
  const neighbors = useMemo(
    () => readableNeighbors(visibleMessages, decrypted),
    [visibleMessages, decrypted],
  );
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
        messages: visibleMessages,
        decrypted,
        events: membershipEvents,
        collapseLeading: !groupProblem,
      }),
    [visibleMessages, decrypted, membershipEvents, groupProblem],
  );
  // Only what this device actually read is acknowledged: an undecryptable message was not delivered.
  const newestItems = newestPage?.items;
  const readableMessageIds = useMemo(
    () =>
      (newestItems ?? [])
        .filter(
          (message) =>
            !isEditMessage(message) && message.senderId !== userId && decrypted[message.id]?.status === "ok",
        )
        .map((message) => message.id),
    [newestItems, userId, decrypted],
  );
  const lastMessage = newestPage ? (visibleMessages.at(-1) ?? null) : undefined;
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
    displayMessages: visibleMessages,
    decrypted,
    edited,
    messagesById,
    neighbors,
    groupProblem,
    safety,
    safetyPeerIds,
    threadItems,
    readableMessageIds,
    announcement,
    now,
  };
}
