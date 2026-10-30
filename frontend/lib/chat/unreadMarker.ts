import { isEditMessage } from './messageEdits';

interface MarkerMessage {
  id: string;
  senderId?: string;
  createdAt?: string;
  contentType?: string;
  status?: string;
  receipts?: Array<{ userId: string; readAt?: string | null }>;
}

/** The element id of the NEW line drawn above `messageId`. */
export const newLineElementId = (messageId: string) => `chat-new-line-${messageId}`;

/** A message someone else wrote that you can see: an edit, a conversation-start marker or an unsent message never is. */
export function countsAsNew(message: MarkerMessage, userId: string | undefined): boolean {
  return (
    message.senderId !== userId &&
    !isEditMessage(message) &&
    message.contentType !== 'SYSTEM' &&
    message.status !== 'DELETED'
  );
}

/**
 * Where the "NEW" line goes when a chat opens: the oldest loaded message from someone else that
 * this user has not read yet (their own receipt on it is unread). A message with no receipt for
 * them came before they joined, so it is never new. `messages` are oldest first.
 */
export function firstUnreadMessage<M extends MarkerMessage>(
  messages: M[],
  userId: string | undefined,
): M | undefined {
  return messages.find(
    (message) =>
      countsAsNew(message, userId) &&
      message.receipts?.some((receipt) => receipt.userId === userId && !receipt.readAt),
  );
}

/**
 * The message to mark read up to for "mark everything read": the newest one from someone else that
 * still exists. The server only marks up to a sent message, so an unsent one would mark nothing.
 */
export function newestToMarkRead<M extends MarkerMessage>(
  messages: M[],
  userId: string | undefined,
): M | undefined {
  return messages.filter((message) => message.senderId !== userId && message.status !== 'DELETED').at(-1);
}
