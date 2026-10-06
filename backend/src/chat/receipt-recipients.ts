import {
  canSeeReadTime,
  hasJoinedConversation,
  toReceiptParties,
  type ReceiptPartyRow,
} from './receipt-visibility';

/** The other people who can see the thread: the only ones who could have sent what was received or read. */
function othersInThread(
  rows: ReadonlyArray<ReceiptPartyRow>,
  readerId: string,
): ReceiptPartyRow[] {
  return rows.filter(
    (row) =>
      row.userId !== readerId &&
      !row.deletedAt &&
      hasJoinedConversation(row.state),
  );
}

/** Who should hear that `readerId` received messages: everyone else in the thread. */
export function deliveryRecipientIds(
  rows: ReadonlyArray<ReceiptPartyRow>,
  readerId: string,
): string[] {
  return othersInThread(rows, readerId).map((row) => row.userId);
}

/** Who should hear that `readerId` read messages: those in the thread who may see read times. */
export function readRecipientIds(
  rows: ReadonlyArray<ReceiptPartyRow>,
  readerId: string,
): string[] {
  const parties = toReceiptParties(rows);
  const reader = parties.get(readerId);

  return othersInThread(rows, readerId)
    .filter((row) => canSeeReadTime(reader, parties.get(row.userId)))
    .map((row) => row.userId);
}
