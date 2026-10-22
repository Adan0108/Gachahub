"use client";

import { useEffect, useRef } from "react";

/**
 * Messages this device can never read (the conversation-start marker, anything it could not decrypt)
 * would otherwise stay unread forever, keeping the badge and bold preview on. While the conversation
 * still shows unread, reports the newest of them as read, once per message.
 */
export function useAcknowledgeUnreadable({
  conversationId,
  unreadCount,
  messageId,
  onRead,
}: {
  conversationId?: string | null;
  unreadCount?: number;
  messageId?: string | null;
  onRead: (messageId: string) => unknown;
}) {
  const doneRef = useRef("");
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  useEffect(() => {
    if (!conversationId || !messageId || !((unreadCount ?? 0) > 0)) return;
    const key = `${conversationId}:${messageId}`;
    if (doneRef.current === key) return;
    doneRef.current = key;
    onReadRef.current(messageId);
  }, [conversationId, messageId, unreadCount]);
}
