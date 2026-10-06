import type { ChatParticipantState } from '../generated/prisma/client';

// Typed against the schema, so a renamed or removed state is a build error, not a quiet "nobody sees reads".
const JOINED_STATES: ReadonlyArray<ChatParticipantState> = [
  'ACTIVE',
  'ARCHIVED',
];

export interface ReceiptParty {
  /** The person's "send read receipts" setting. */
  sendsReadReceipts: boolean;
  /** Their state in the conversation. */
  state: ChatParticipantState;
}

/** A row from ChatRepository.findReceiptParties. */
export interface ReceiptPartyRow {
  userId: string;
  state: ChatParticipantState;
  deletedAt: Date | null;
  user: { sendReadReceipts: boolean };
}

/** Whether someone has accepted the conversation; a pending request has not been accepted yet. */
export function hasJoinedConversation(state: ChatParticipantState): boolean {
  return JOINED_STATES.includes(state);
}

/**
 * The one rule for "may this viewer see when that reader read their message": the reader shares
 * read receipts, the viewer does too (it is mutual), and the reader has accepted the conversation.
 * Delivery is not covered here; it is always shown.
 */
export function canSeeReadTime(
  reader: ReceiptParty | undefined,
  viewer: Pick<ReceiptParty, 'sendsReadReceipts'> | undefined,
): boolean {
  return Boolean(
    reader?.sendsReadReceipts &&
    viewer?.sendsReadReceipts &&
    hasJoinedConversation(reader.state),
  );
}

/** The party rows by user id, for the places that apply canSeeReadTime. */
export function toReceiptParties(
  rows: ReadonlyArray<ReceiptPartyRow>,
): Map<string, ReceiptParty> {
  return new Map(
    rows.map((row) => [
      row.userId,
      { sendsReadReceipts: row.user.sendReadReceipts, state: row.state },
    ]),
  );
}
