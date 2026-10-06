export type MessageStatus = 'sent' | 'delivered' | 'seen';

/** A receipt as the server sends it (delivery as a yes or no) or as a fresh send returns it (with times). */
export interface ReceiptLike {
  userId: string;
  delivered?: boolean;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export interface StatusMessage {
  id: string;
  senderId: string;
  status?: string;
  contentType?: string;
  receipts?: ReceiptLike[];
}

export const hasRead = (receipt: ReceiptLike): boolean => Boolean(receipt.readAt);

// A read counts as delivered too, whichever way the receipt says it.
export const hasDelivered = (receipt: ReceiptLike): boolean =>
  Boolean(receipt.delivered ?? receipt.deliveredAt) || hasRead(receipt);

/** Where a message you sent stands: seen if any of the others read it, delivered if any got it, otherwise sent. */
export function statusOf(message: StatusMessage, otherUserIds: string[]): MessageStatus {
  const theirs = (message.receipts ?? []).filter((receipt) => otherUserIds.includes(receipt.userId));
  if (theirs.some(hasRead)) return 'seen';
  if (theirs.some(hasDelivered)) return 'delivered';
  return 'sent';
}

export interface ReceiptDisplay {
  /** The message to put Sent / Delivered / Seen under: your newest, and only while nobody has written after it. */
  statusFor: Map<string, MessageStatus>;
  /** For each message, who has read up to exactly there (groups only): each person sits under the last message of yours they read. */
  readersAt: Map<string, string[]>;
}

/** What to show about sent, delivered and seen across a thread; `messages` are the ones on screen, oldest first. */
export function receiptDisplay(
  messages: StatusMessage[],
  userId: string,
  otherUserIds: string[],
  { isGroup }: { isGroup: boolean },
): ReceiptDisplay {
  const shown = messages.filter((message) => message.status !== 'DELETED' && message.contentType !== 'EDIT');
  const statusFor = new Map<string, MessageStatus>();
  const readersAt = new Map<string, string[]>();

  const newest = shown[shown.length - 1];
  // `newest` can be missing, and so can userId before the account loads, so check the message itself.
  if (newest && newest.senderId === userId) statusFor.set(newest.id, statusOf(newest, otherUserIds));

  if (isGroup) {
    for (const otherId of otherUserIds) {
      const lastRead = [...shown]
        .reverse()
        .find(
          (message) =>
            message.senderId === userId &&
            (message.receipts ?? []).some((receipt) => receipt.userId === otherId && hasRead(receipt)),
        );
      if (lastRead) readersAt.set(lastRead.id, [...(readersAt.get(lastRead.id) ?? []), otherId]);
    }
  }

  return { statusFor, readersAt };
}
