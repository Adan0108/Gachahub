import { describe, expect, it } from 'vitest';
import { hasDelivered, hasRead, receiptDisplay, statusOf, type StatusMessage } from './messageStatus';

const READ = '2026-10-06T10:05:00.000Z';

const mine = (id: string, receipts: StatusMessage['receipts'] = [], extra: Partial<StatusMessage> = {}): StatusMessage => ({
  id,
  senderId: 'me',
  receipts,
  ...extra,
});
const theirs = (id: string): StatusMessage => ({ id, senderId: 'bob', receipts: [] });

describe('hasDelivered / hasRead', () => {
  it('reads the shared shape, where delivery is a yes or no', () => {
    expect(hasDelivered({ userId: 'bob', delivered: true })).toBe(true);
    expect(hasDelivered({ userId: 'bob', delivered: false })).toBe(false);
  });

  it('reads the shape a fresh send returns, with times', () => {
    expect(hasDelivered({ userId: 'bob', deliveredAt: READ })).toBe(true);
    expect(hasDelivered({ userId: 'bob', deliveredAt: null })).toBe(false);
  });

  it('counts a read as delivered, whichever way the receipt says it', () => {
    expect(hasDelivered({ userId: 'bob', delivered: false, readAt: READ })).toBe(true);
    expect(hasDelivered({ userId: 'bob', readAt: READ })).toBe(true);
  });

  it('has read only when there is a read time', () => {
    expect(hasRead({ userId: 'bob', readAt: READ })).toBe(true);
    expect(hasRead({ userId: 'bob', readAt: null })).toBe(false);
    expect(hasRead({ userId: 'bob' })).toBe(false);
  });
});

describe('statusOf', () => {
  it('is sent while nobody has it', () => {
    expect(statusOf(mine('m1', [{ userId: 'bob', delivered: false }]), ['bob'])).toBe('sent');
  });

  it('is sent for a message with no receipts at all, such as one just pushed over the socket', () => {
    expect(statusOf({ id: 'm1', senderId: 'me' }, ['bob'])).toBe('sent');
  });

  it('is delivered once another person got it', () => {
    expect(statusOf(mine('m1', [{ userId: 'bob', delivered: true }]), ['bob'])).toBe('delivered');
  });

  it('is seen once another person read it', () => {
    expect(statusOf(mine('m1', [{ userId: 'bob', delivered: true, readAt: READ }]), ['bob'])).toBe('seen');
  });

  it('ignores your own receipt, which starts out delivered and read', () => {
    expect(statusOf(mine('m1', [{ userId: 'me', delivered: true, readAt: READ }]), ['bob'])).toBe('sent');
  });

  it('ignores people who are not among the others, such as someone who left', () => {
    expect(statusOf(mine('m1', [{ userId: 'gone', delivered: true, readAt: READ }]), ['bob'])).toBe('sent');
  });

  it('is seen in a group when any one member read it', () => {
    const receipts = [
      { userId: 'ann', delivered: true },
      { userId: 'bob', delivered: true, readAt: READ },
    ];
    expect(statusOf(mine('m1', receipts), ['ann', 'bob'])).toBe('seen');
  });
});

describe('receiptDisplay', () => {
  const seen = { userId: 'bob', delivered: true, readAt: READ };

  it('shows the status of your newest message when it is the last one in the thread', () => {
    const result = receiptDisplay([mine('m1', [seen]), mine('m2', [{ userId: 'bob', delivered: true }])], 'me', ['bob'], {
      isGroup: false,
    });

    expect([...result.statusFor]).toEqual([['m2', 'delivered']]);
  });

  it('shows nothing once somebody else has written after your last message', () => {
    const result = receiptDisplay([mine('m1', [seen]), theirs('m2')], 'me', ['bob'], { isGroup: false });

    expect(result.statusFor.size).toBe(0);
  });

  it('leaves out unsent messages and hidden edits when finding the last message', () => {
    const result = receiptDisplay(
      [mine('m1'), mine('m2', [], { status: 'DELETED' }), theirs('m3'), { ...theirs('m4'), contentType: 'EDIT' }],
      'me',
      ['bob'],
      { isGroup: false },
    );

    // the last real message is bob's m3, so there is no status; and an unsent m2 cannot be it either
    expect(result.statusFor.size).toBe(0);

    const afterUnsend = receiptDisplay([mine('m1'), mine('m2', [], { status: 'DELETED' })], 'me', ['bob'], {
      isGroup: false,
    });
    expect([...afterUnsend.statusFor]).toEqual([['m1', 'sent']]);
  });

  it('shows nothing for an empty thread', () => {
    const result = receiptDisplay([], 'me', ['bob'], { isGroup: false });

    expect(result.statusFor.size).toBe(0);
    expect(result.readersAt.size).toBe(0);
  });

  it('does not break before the account has loaded, when there is no user id yet', () => {
    const empty = receiptDisplay([], undefined as unknown as string, [], { isGroup: false });
    expect(empty.statusFor.size).toBe(0);

    const withMessages = receiptDisplay([theirs('m1')], undefined as unknown as string, [], { isGroup: true });
    expect(withMessages.statusFor.size).toBe(0);
    expect(withMessages.readersAt.size).toBe(0);
  });

  it('does not place reader avatars in a direct chat', () => {
    const result = receiptDisplay([mine('m1', [seen])], 'me', ['bob'], { isGroup: false });

    expect(result.readersAt.size).toBe(0);
  });

  it('puts each group member under the last message of yours they read', () => {
    const result = receiptDisplay(
      [
        mine('m1', [{ userId: 'ann', delivered: true, readAt: READ }, { userId: 'bob', delivered: true, readAt: READ }]),
        mine('m2', [{ userId: 'bob', delivered: true, readAt: READ }]),
        mine('m3', [{ userId: 'ann', delivered: true }, { userId: 'bob', delivered: true }]),
      ],
      'me',
      ['ann', 'bob'],
      { isGroup: true },
    );

    expect(result.readersAt.get('m1')).toEqual(['ann']);
    expect(result.readersAt.get('m2')).toEqual(['bob']);
    expect(result.readersAt.has('m3')).toBe(false);
    expect(result.statusFor.get('m3')).toBe('delivered');
  });

  it('puts several members who stopped at the same message together', () => {
    const result = receiptDisplay(
      [mine('m1', [{ userId: 'ann', readAt: READ }, { userId: 'bob', readAt: READ }])],
      'me',
      ['ann', 'bob'],
      { isGroup: true },
    );

    expect(result.readersAt.get('m1')).toEqual(['ann', 'bob']);
  });

  it('ignores reads by people who are not among the others', () => {
    const result = receiptDisplay([mine('m1', [{ userId: 'gone', readAt: READ }])], 'me', ['ann'], { isGroup: true });

    expect(result.readersAt.size).toBe(0);
  });

  it('never places readers on messages sent by someone else', () => {
    const result = receiptDisplay([{ ...theirs('m1'), receipts: [{ userId: 'ann', readAt: READ }] }], 'me', ['ann'], {
      isGroup: true,
    });

    expect(result.readersAt.size).toBe(0);
  });
});
