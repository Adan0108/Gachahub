import { describe, expect, it } from 'vitest';
import { firstUnreadMessage, newestToMarkRead } from './unreadMarker';

const message = (id: string, senderId: string, readAt: string | null | undefined, extra = {}) => ({
  id,
  senderId,
  receipts: readAt === undefined ? [] : [{ userId: 'me', readAt }],
  ...extra,
});

describe('firstUnreadMessage', () => {
  it('is the oldest message from someone else that I have not read', () => {
    const messages = [
      message('m1', 'bob', '2026-10-26T09:00:00Z'),
      message('m2', 'me', null),
      message('m3', 'bob', null),
      message('m4', 'bob', null),
    ];

    expect(firstUnreadMessage(messages, 'me')?.id).toBe('m3');
  });

  it('skips edits, conversation-start markers, unsent messages and ones from before I joined', () => {
    const messages = [
      message('edit', 'bob', null, { contentType: 'EDIT' }),
      message('start', 'bob', null, { contentType: 'SYSTEM' }),
      message('gone', 'bob', null, { status: 'DELETED' }),
      message('before-me', 'bob', undefined),
      message('m5', 'bob', null),
    ];

    expect(firstUnreadMessage(messages, 'me')?.id).toBe('m5');
  });

  it('is nothing when everything is read', () => {
    expect(firstUnreadMessage([message('m1', 'bob', '2026-10-26T09:00:00Z')], 'me')).toBeUndefined();
  });
});

describe('newestToMarkRead', () => {
  it('is the newest message from someone else that still exists', () => {
    const messages = [
      message('m1', 'bob', null),
      message('m2', 'bob', null),
      message('gone', 'bob', null, { status: 'DELETED' }),
      message('mine', 'me', null),
    ];

    expect(newestToMarkRead(messages, 'me')?.id).toBe('m2');
  });
});
