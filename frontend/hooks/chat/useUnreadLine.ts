"use client";

import { useEffect, useRef, useState } from "react";
import { countsAsNew, firstUnreadMessage, newestToMarkRead } from "../../lib/chat/unreadMarker";

// Once everything is read and you are at the bottom, the NEW line stays this long, then goes.
const CLEAR_AFTER_READ_MS = 5000;

type Marker = { conversationId: string; id: string; at: number };
type LineMessage = Parameters<typeof firstUnreadMessage>[0][number];

const timeOf = (message: { createdAt?: string }) => Date.parse(message.createdAt ?? "") || 0;

/**
 * Discord's red NEW line for one chat: above the first message you had not read when you opened
 * it, or the first one that arrived while you were not watching (scrolled up, or in another tab).
 * It stays put while you read, and goes once you have read everything and stayed at the bottom a
 * moment, when you send a message, or when you mark everything read. `bar` is the "N new messages
 * since" bar above the thread, shown while there is a line and something unread.
 */
export function useUnreadLine({
  conversationId,
  messages,
  newestPageItems,
  unreadCount,
  userId,
  atBottom,
  markRead,
  sentCount,
}: {
  conversationId: string;
  /** Loaded messages, oldest first, without edits. */
  messages: LineMessage[];
  /** The newest page as the server sent it, edits included; undefined until it has loaded. */
  newestPageItems: LineMessage[] | undefined;
  /** The chat list's unread count for this chat: the server's word. */
  unreadCount: number | undefined;
  userId: string | undefined;
  atBottom: boolean;
  markRead: (messageId: string) => void;
  /** How many messages you have sent from this chat; a rise means you sent one. */
  sentCount: number;
}) {
  const [marker, setMarker] = useState<Marker | null>(null);
  // The chat the line was placed for on opening; a different one (or none) places it afresh.
  const [placedFor, setPlacedFor] = useState<string | null>(null);

  // Placed during render, so the line is there in the first paint of the chat.
  if (!conversationId && placedFor) setPlacedFor(null);
  if (placedFor !== conversationId && conversationId && newestPageItems && unreadCount !== undefined) {
    setPlacedFor(conversationId);
    // A cached page can still carry old receipts, so the server's count must agree first.
    const first = unreadCount > 0 ? firstUnreadMessage(messages, userId) : undefined;
    setMarker(first ? { conversationId, id: first.id, at: timeOf(first) } : null);
  }
  const line = marker?.conversationId === conversationId ? marker : null;

  // A message arriving while you are not watching gets the line, if there is none yet. Only
  // messages newer than what the chat opened with count: older history loading in is not new.
  const newestSeen = useRef<{ conversationId: string | null; at: number }>({ conversationId: null, at: 0 });
  useEffect(() => {
    if (placedFor !== conversationId || !conversationId) return;
    const newest = Math.max(0, ...messages.map(timeOf));
    if (newestSeen.current.conversationId !== conversationId) {
      newestSeen.current = { conversationId, at: newest };
      return;
    }
    const arrived = messages.filter((message) => timeOf(message) > newestSeen.current.at);
    if (arrived.length === 0) return;
    newestSeen.current.at = newest;
    // A visible chat at the bottom is being watched even when another window has focus.
    const watching = atBottom && document.visibilityState === "visible";
    const firstNew = arrived.find((message) => countsAsNew(message, userId));
    if (!watching && firstNew && !line) {
      setMarker({ conversationId, id: firstNew.id, at: timeOf(firstNew) });
    }
  }, [messages, placedFor, conversationId, atBottom, userId, line]);

  // Everything read and you are at the bottom: the line has done its job.
  useEffect(() => {
    if (!line || unreadCount !== 0 || !atBottom) return undefined;
    const timer = setTimeout(() => setMarker(null), CLEAR_AFTER_READ_MS);
    return () => clearTimeout(timer);
  }, [line, unreadCount, atBottom]);

  // Sending a message means you are caught up.
  const previousSent = useRef(sentCount);
  useEffect(() => {
    if (sentCount > previousSent.current) setMarker(null);
    previousSent.current = sentCount;
  }, [sentCount]);

  return {
    line,
    bar: line && unreadCount ? { count: unreadCount, since: line.at } : null,
    /** Marks the chat read and takes the line away. */
    markAllRead: () => {
      setMarker(null);
      if (!unreadCount) return;
      const newest = newestToMarkRead(newestPageItems ?? [], userId);
      if (newest) markRead(newest.id);
    },
  };
}
