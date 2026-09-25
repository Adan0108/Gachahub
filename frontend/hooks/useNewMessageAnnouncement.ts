"use client";

import { useState } from "react";
import {
  nextAnnouncement,
  type AnnouncementState,
  type LastMessage,
} from "../lib/chatAnnouncement";

/** Text for a polite live region that speaks only when a new message lands at the end of the thread. */
export function useNewMessageAnnouncement(
  conversationId: string,
  last: LastMessage | null | undefined,
  ownUserId: string | undefined,
  senderName: string,
): { text: string; seq: number } {
  const [state, setState] = useState<AnnouncementState>({
    conversationId,
    lastId: last === undefined ? undefined : (last?.id ?? null),
    text: "",
    seq: 0,
  });
  // Derived during render (not in an effect), like useConversationHistory's conversation reset.
  const next = nextAnnouncement(state, { conversationId, last, ownUserId, senderName });
  if (next !== state) setState(next);
  return next;
}
