"use client";

import { useMemo } from "react";
import { otherActiveMemberIds } from "../../lib/chat/chatDisplay";
import { receiptDisplay } from "../../lib/chat/messageStatus";
import type { StatusMessage } from "../../lib/chat/messageStatus";
import type { ChatConversation } from "../../lib/chat/chatDisplay";

interface ReceiptOptions {
  messages: StatusMessage[];
  hiddenMessageIds: Set<string>;
  userId: string;
  conversation?: ChatConversation | null;
  peerId?: string | null;
  hasPending: boolean;
}

/**
 * Sent, delivered and seen for the open thread: under your last message, and for a group who has
 * read up to where. The status is held back while a newer message of yours is still sending below it.
 */
export function useReceiptDisplay({
  messages,
  hiddenMessageIds,
  userId,
  conversation,
  peerId,
  hasPending,
}: ReceiptOptions) {
  const isGroup = conversation?.type === "GROUP";

  return useMemo(() => {
    const others = isGroup
      ? otherActiveMemberIds(conversation, userId)
      : [peerId].filter((id): id is string => Boolean(id));
    const info = receiptDisplay(
      messages.filter((message) => !hiddenMessageIds.has(message.id)),
      userId,
      others,
      { isGroup },
    );
    return hasPending ? { ...info, statusFor: new Map() } : info;
  }, [messages, hiddenMessageIds, userId, conversation, peerId, isGroup, hasPending]);
}
