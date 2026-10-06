import type { ChatParticipantState } from '../generated/prisma/client';
import { maskReceiptsForViewer } from './receipt.mapper';
import type { ReceiptPartyRow } from './receipt-visibility';

const row = (
  userId: string,
  sendReadReceipts = true,
  state: ChatParticipantState = 'ACTIVE',
): ReceiptPartyRow => ({
  userId,
  state,
  deletedAt: null,
  user: { sendReadReceipts },
});

describe('maskReceiptsForViewer', () => {
  const delivered = new Date('2026-10-06T10:00:00.000Z');
  const read = new Date('2026-10-06T10:05:00.000Z');
  const receipt = (
    messageId: string,
    userId: string,
    overrides: Partial<{ deliveredAt: Date | null; readAt: Date | null }> = {},
  ) => ({
    id: `r-${messageId}-${userId}`,
    messageId,
    userId,
    deliveredAt: delivered,
    readAt: read,
    createdAt: new Date(),
    updatedAt: read,
    ...overrides,
  });
  const message = (
    id: string,
    senderId: string,
    receipts: ReturnType<typeof receipt>[],
  ) => ({ id, senderId, ciphertext: 'x', receipts });

  const rows = [
    row('me'),
    row('bob'),
    row('quiet', false),
    row('stranger', true, 'PENDING'),
  ];

  it('shows the read time of others on your own messages when they share receipts', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'me'), receipt('m1', 'bob')])],
      'me',
      rows,
    );

    expect(masked?.receipts.find((r) => r.userId === 'bob')).toEqual({
      messageId: 'm1',
      userId: 'bob',
      delivered: true,
      readAt: read,
    });
  });

  it('hides the read time but keeps delivery when the reader has receipts off', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'quiet')])],
      'me',
      rows,
    );

    expect(masked?.receipts[0]).toMatchObject({
      userId: 'quiet',
      delivered: true,
      readAt: null,
    });
  });

  it('hides read times from a viewer who has receipts off', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'bob')])],
      'me',
      [row('me', false), row('bob')],
    );

    expect(masked?.receipts[0]?.readAt).toBeNull();
    expect(masked?.receipts[0]?.delivered).toBe(true);
  });

  it('hides the read time of someone who has not accepted the conversation', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'stranger')])],
      'me',
      rows,
    );

    expect(masked?.receipts[0]?.readAt).toBeNull();
  });

  it('hides the read time of someone no longer in the conversation', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'gone')])],
      'me',
      rows,
    );

    expect(masked?.receipts[0]?.readAt).toBeNull();
  });

  it('shows delivery as a yes or no, never as a time', () => {
    const [masked] = maskReceiptsForViewer(
      [
        message('m1', 'me', [
          receipt('m1', 'bob'),
          receipt('m1', 'quiet', { deliveredAt: null, readAt: null }),
        ]),
      ],
      'me',
      rows,
    );

    expect(masked?.receipts[0]).toMatchObject({ delivered: true });
    expect(masked?.receipts[1]).toMatchObject({ delivered: false });
    expect(masked?.receipts[0]).not.toHaveProperty('deliveredAt');
    expect(masked?.receipts[1]).not.toHaveProperty('deliveredAt');
  });

  it('gives every receipt the same four fields, with no ids or update times', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'me'), receipt('m1', 'quiet')])],
      'me',
      rows,
    );

    for (const shown of masked?.receipts ?? []) {
      expect(Object.keys(shown).sort()).toEqual([
        'delivered',
        'messageId',
        'readAt',
        'userId',
      ]);
    }
  });

  it("shows only your own receipt on other people's messages", () => {
    const [masked] = maskReceiptsForViewer(
      [
        message('m1', 'bob', [
          receipt('m1', 'me'),
          receipt('m1', 'bob'),
          receipt('m1', 'quiet'),
        ]),
      ],
      'me',
      rows,
    );

    expect(masked?.receipts.map((r) => r.userId)).toEqual(['me']);
    expect(Object.keys(masked?.receipts[0] ?? {}).sort()).toEqual([
      'delivered',
      'messageId',
      'readAt',
      'userId',
    ]);
  });

  it('lists your own receipt first on your own message', () => {
    const [masked] = maskReceiptsForViewer(
      [message('m1', 'me', [receipt('m1', 'bob'), receipt('m1', 'me')])],
      'me',
      rows,
    );

    expect(masked?.receipts.map((r) => r.userId)).toEqual(['me', 'bob']);
  });

  it('keeps everything else on the message, and does not change the input', () => {
    const input = [message('m1', 'me', [receipt('m1', 'quiet')])];

    const [masked] = maskReceiptsForViewer(input, 'me', rows);

    expect(masked).toMatchObject({ id: 'm1', ciphertext: 'x' });
    expect(input[0]?.receipts[0]?.readAt).toEqual(read);
  });

  it('copes with no messages', () => {
    expect(maskReceiptsForViewer([], 'me', rows)).toEqual([]);
  });
});
