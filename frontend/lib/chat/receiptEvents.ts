import type { ReceiptLike } from './messageStatus';

/** What the server sends when someone's device received messages, or someone read up to one. */
export type ReceiptsEvent =
  | { kind: 'delivered'; conversationId: string; userId: string; messageIds: string[] }
  | { kind: 'read'; conversationId: string; userId: string; upToMessageId: string; at: string };

interface CachedMessage {
  id: string;
  senderId: string;
  receipts?: ReceiptLike[];
}

/** Puts this person's receipt on a message into the shared shape, keeping a read time it already had. */
function withReceipt<Message extends CachedMessage>(
  message: Message,
  userId: string,
  patch: { readAt?: string },
): Message {
  const receipts = message.receipts ?? [];
  const existing = receipts.find((receipt) => receipt.userId === userId);
  const next = {
    userId,
    delivered: true,
    readAt: patch.readAt ?? existing?.readAt ?? null,
  };
  return {
    ...message,
    receipts: existing
      ? receipts.map((receipt) => (receipt.userId === userId ? next : receipt))
      : [...receipts, next],
  };
}

/**
 * The cached messages (oldest first) after an event. Returns null when a read points at a message
 * that is not in the list, so the caller can fetch it fresh instead of guessing.
 */
export function applyReceiptsEvent<Message extends CachedMessage>(
  messages: Message[],
  event: ReceiptsEvent,
): Message[] | null {
  if (event.kind === 'delivered') {
    const ids = new Set(event.messageIds);
    return messages.map((message) => (ids.has(message.id) ? withReceipt(message, event.userId, {}) : message));
  }

  const upTo = messages.findIndex((message) => message.id === event.upToMessageId);
  if (upTo === -1) return null;

  // Reading up to a message means reading everything sent before it, so every earlier message gets the read.
  return messages.map((message, index) =>
    index <= upTo && message.senderId !== event.userId
      ? withReceipt(message, event.userId, { readAt: event.at })
      : message,
  );
}
