import type { ChatParticipantState } from '../generated/prisma/client';
import { deliveryRecipientIds, readRecipientIds } from './receipt-recipients';
import type { ReceiptPartyRow } from './receipt-visibility';

const row = (
  userId: string,
  overrides: Partial<{
    state: ChatParticipantState;
    deletedAt: Date | null;
    sendReadReceipts: boolean;
  }> = {},
): ReceiptPartyRow => ({
  userId,
  state: overrides.state ?? 'ACTIVE',
  deletedAt: overrides.deletedAt ?? null,
  user: { sendReadReceipts: overrides.sendReadReceipts ?? true },
});

describe('deliveryRecipientIds', () => {
  it('is everyone else who can see the thread, never the reader', () => {
    expect(deliveryRecipientIds([row('a'), row('b'), row('c')], 'a')).toEqual([
      'b',
      'c',
    ]);
  });

  it('still includes someone who has read receipts off, delivery always shows', () => {
    expect(
      deliveryRecipientIds(
        [row('a', { sendReadReceipts: false }), row('b')],
        'a',
      ),
    ).toEqual(['b']);
  });

  it('includes archived members', () => {
    expect(
      deliveryRecipientIds([row('a'), row('b', { state: 'ARCHIVED' })], 'a'),
    ).toEqual(['b']);
  });

  it('leaves out people who left, declined, were blocked or have not accepted', () => {
    expect(
      deliveryRecipientIds(
        [
          row('a'),
          row('b', { deletedAt: new Date() }),
          row('c', { state: 'DECLINED' }),
          row('d', { state: 'BLOCKED' }),
          row('e', { state: 'PENDING' }),
        ],
        'a',
      ),
    ).toEqual([]);
  });
});

describe('readRecipientIds', () => {
  it('is everyone else in the thread when all of them share receipts', () => {
    expect(readRecipientIds([row('a'), row('b'), row('c')], 'a')).toEqual([
      'b',
      'c',
    ]);
  });

  it('is nobody when the reader has receipts off', () => {
    expect(
      readRecipientIds([row('a', { sendReadReceipts: false }), row('b')], 'a'),
    ).toEqual([]);
  });

  it('is nobody while the reader has not accepted the conversation', () => {
    expect(
      readRecipientIds([row('a', { state: 'PENDING' }), row('b')], 'a'),
    ).toEqual([]);
  });

  it('leaves out someone who has receipts off themselves (it is mutual)', () => {
    expect(
      readRecipientIds(
        [row('a'), row('b', { sendReadReceipts: false }), row('c')],
        'a',
      ),
    ).toEqual(['c']);
  });

  it('leaves out people who left or are not in the thread', () => {
    expect(
      readRecipientIds(
        [
          row('a'),
          row('b', { deletedAt: new Date() }),
          row('c', { state: 'DECLINED' }),
        ],
        'a',
      ),
    ).toEqual([]);
  });

  it('is nobody when the reader is not in the conversation', () => {
    expect(readRecipientIds([row('b')], 'a')).toEqual([]);
  });
});
