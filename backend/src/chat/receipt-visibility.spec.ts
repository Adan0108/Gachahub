import type { ChatParticipantState } from '../generated/prisma/client';
import {
  canSeeReadTime,
  hasJoinedConversation,
  toReceiptParties,
  type ReceiptParty,
} from './receipt-visibility';

const party = (
  sendsReadReceipts = true,
  state: ChatParticipantState = 'ACTIVE',
): ReceiptParty => ({ sendsReadReceipts, state });

describe('hasJoinedConversation', () => {
  it.each<ChatParticipantState>(['ACTIVE', 'ARCHIVED'])(
    'is true for %s',
    (state) => {
      expect(hasJoinedConversation(state)).toBe(true);
    },
  );

  it.each<ChatParticipantState>([
    'PENDING',
    'DECLINED',
    'BLOCKED',
    'JOINING',
    'LEAVING',
  ])('is false for %s', (state) => {
    expect(hasJoinedConversation(state)).toBe(false);
  });
});

describe('canSeeReadTime', () => {
  it('is allowed when both sides share receipts and the reader accepted the chat', () => {
    expect(canSeeReadTime(party(), party())).toBe(true);
    expect(canSeeReadTime(party(true, 'ARCHIVED'), party())).toBe(true);
  });

  it('is hidden when the reader has receipts off', () => {
    expect(canSeeReadTime(party(false), party())).toBe(false);
  });

  it('is hidden from a viewer who has receipts off (it is mutual)', () => {
    expect(canSeeReadTime(party(), party(false))).toBe(false);
  });

  it.each<ChatParticipantState>([
    'PENDING',
    'DECLINED',
    'BLOCKED',
    'JOINING',
    'LEAVING',
  ])('is hidden while the reader is %s', (state) => {
    expect(canSeeReadTime(party(true, state), party())).toBe(false);
  });

  it('is hidden for someone who is not in the conversation', () => {
    expect(canSeeReadTime(undefined, party())).toBe(false);
    expect(canSeeReadTime(party(), undefined)).toBe(false);
  });
});

describe('toReceiptParties', () => {
  it('reads each row into a party, by user id', () => {
    const parties = toReceiptParties([
      {
        userId: 'a',
        state: 'ACTIVE',
        deletedAt: null,
        user: { sendReadReceipts: true },
      },
      {
        userId: 'b',
        state: 'PENDING',
        deletedAt: new Date(),
        user: { sendReadReceipts: false },
      },
    ]);

    expect(parties.get('a')).toEqual({
      sendsReadReceipts: true,
      state: 'ACTIVE',
    });
    expect(parties.get('b')).toEqual({
      sendsReadReceipts: false,
      state: 'PENDING',
    });
    expect(parties.get('nobody')).toBeUndefined();
  });
});
