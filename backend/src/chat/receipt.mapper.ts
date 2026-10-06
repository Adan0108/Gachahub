import {
  canSeeReadTime,
  toReceiptParties,
  type ReceiptPartyRow,
} from './receipt-visibility';

interface ReceiptLike {
  messageId: string;
  userId: string;
  deliveredAt: Date | null;
  readAt: Date | null;
}

/**
 * How a receipt is shown to anyone: no ids or update times, which would give a read away, and
 * delivery as a yes or no rather than a time, since a delivery time is a close guess at when
 * someone opened the app to read.
 */
export interface SharedReceipt {
  messageId: string;
  userId: string;
  delivered: boolean;
  readAt: Date | null;
}

export type MessageWithSharedReceipts<Message> = Omit<Message, 'receipts'> & {
  receipts: SharedReceipt[];
};

const share = (receipt: ReceiptLike): SharedReceipt => ({
  messageId: receipt.messageId,
  userId: receipt.userId,
  delivered: receipt.deliveredAt !== null,
  readAt: receipt.readAt,
});

/**
 * Trims each message's receipts to what `viewerId` is allowed to know, all in the SharedReceipt
 * shape. On their own messages they see everyone's delivery and their own read, and others' read
 * times only where canSeeReadTime allows; on anyone else's messages they see only their own receipt.
 */
export function maskReceiptsForViewer<
  Message extends { senderId: string; receipts: ReceiptLike[] },
>(
  messages: Message[],
  viewerId: string,
  partyRows: ReadonlyArray<ReceiptPartyRow>,
): Array<MessageWithSharedReceipts<Message>> {
  const parties = toReceiptParties(partyRows);
  const viewer = parties.get(viewerId);

  return messages.map((message) => {
    const own = message.receipts
      .filter((receipt) => receipt.userId === viewerId)
      .map(share);
    const others =
      message.senderId === viewerId
        ? message.receipts
            .filter((receipt) => receipt.userId !== viewerId)
            .map((receipt) => ({
              ...share(receipt),
              readAt: canSeeReadTime(parties.get(receipt.userId), viewer)
                ? receipt.readAt
                : null,
            }))
        : [];

    return { ...message, receipts: [...own, ...others] };
  });
}
