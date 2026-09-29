import { describe, expect, it } from 'vitest';
import {
  buildThreadItems,
  eventsForDisplay,
  membershipEventText,
  messageDividerLabel,
  messageFullTimestamp,
  readableNeighbors,
  replyOriginalSenderLabel,
  threadItemKey,
  wasLikelySentDuringAbsence,
  withOptimisticDelete,
} from './chatThread';
import type { MembershipEvent } from './mls/sync/membershipEvents';

type Status = 'ok' | 'unavailable' | 'pending';
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const message = (id: string, minute: number, contentType?: string, senderId = 'alice') => ({
  id,
  senderId,
  createdAt: at(minute),
  contentType,
});
const decrypted = (statuses: Record<string, Status>) =>
  Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status }]));
const event = (id: string, minute: number): MembershipEvent => ({
  id,
  conversationId: 'c',
  epoch: 1,
  kind: 'joined',
  userId: 'bob',
  at: Date.parse(at(minute)),
});
const shape = (items: ReturnType<typeof buildThreadItems>) =>
  items.map((item) =>
    item.kind === 'message' ? item.message.id : item.kind === 'event' ? item.event.id : item.kind,
  );

describe('eventsForDisplay', () => {
  it('keeps every event kind for a group', () => {
    const events = [event('e1', 0), { ...event('e2', 1), kind: 'device-added' as const }];

    expect(eventsForDisplay(events, true)).toEqual(events);
  });

  it('drops joined/left for a DM, keeping only new-device notices', () => {
    const joined = event('e1', 0);
    const left = { ...event('e2', 1), kind: 'left' as const };
    const deviceAdded = { ...event('e3', 2), kind: 'device-added' as const };

    expect(eventsForDisplay([joined, left, deviceAdded], false)).toEqual([deviceAdded]);
  });
});

describe('buildThreadItems', () => {
  it('collapses leading undecryptable messages into one banner', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2), message('c', 3)],
      decrypted: decrypted({ a: 'unavailable', b: 'unavailable', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['history-banner', 'timestamp', 'c']);
  });

  it('keeps an undecryptable message that follows a readable one', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2), message('c', 3)],
      decrypted: decrypted({ a: 'ok', b: 'unavailable', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'b', 'c']);
  });

  it('steps over the conversation-started row and pending messages while collapsing', () => {
    const items = buildThreadItems({
      messages: [message('s', 0, 'SYSTEM'), message('a', 1), message('p', 2), message('c', 3)],
      decrypted: decrypted({ a: 'unavailable', p: 'pending', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['history-banner', 's', 'timestamp', 'p', 'c']);
  });

  it('shows no banner when nothing is unreadable, and keeps everything when told not to collapse', () => {
    const messages = [message('a', 1), message('b', 2)];
    const allOk = buildThreadItems({
      messages,
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    const uncollapsed = buildThreadItems({
      messages,
      decrypted: decrypted({ a: 'unavailable', b: 'ok' }),
      events: [],
      collapseLeading: false,
    });
    expect(shape(allOk)).toEqual(['timestamp', 'a', 'b']);
    expect(shape(uncollapsed)).toEqual(['timestamp', 'a', 'b']);
  });

  it('places events by time among messages, before a message with the same time', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 5), message('c', 9)],
      decrypted: decrypted({ a: 'ok', b: 'ok', c: 'ok' }),
      events: [event('late', 20), event('tie', 5), event('mid', 3)],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'mid', 'tie', 'b', 'c', 'late']);
  });

  it('records each message index in the original list', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2)],
      decrypted: decrypted({ a: 'unavailable', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({ kind: 'message', index: 1 });
  });

  it('always puts a timestamp above the first visible message', () => {
    const items = buildThreadItems({
      messages: [message('a', 1)],
      decrypted: decrypted({ a: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[0]).toMatchObject({ kind: 'timestamp', at: Date.parse(at(1)) });
  });

  it('puts the divider under "conversation started", not above it', () => {
    const items = buildThreadItems({
      messages: [message('s', 0, 'SYSTEM')],
      decrypted: decrypted({ s: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['s', 'timestamp']);
  });

  it('gives a message a full divider once the gap since the last one passes 45 minutes', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 45)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'timestamp', 'b']);
    expect(items.find((i) => i.kind === 'message' && i.message.id === 'b')).toMatchObject({
      gapBefore: false,
    });
  });

  it('flags only extra spacing, no divider, for a 25-45 minute gap', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 25)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'b']);
    expect(items[2]).toMatchObject({ kind: 'message', message: { id: 'b' }, gapBefore: true });
  });

  it('groups messages under 25 minutes apart with no divider and no extra spacing', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 24)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'b']);
    expect(items[2]).toMatchObject({ kind: 'message', message: { id: 'b' }, gapBefore: false });
  });

  it('stacks two close messages from the same sender, first marked as having a follower', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 1)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[1]).toMatchObject({
      message: { id: 'a' },
      groupedWithPrevious: false,
      groupedWithNext: true,
    });
    expect(items[2]).toMatchObject({
      message: { id: 'b' },
      groupedWithPrevious: true,
      groupedWithNext: false,
    });
  });

  it('does not stack messages from two different senders', () => {
    const items = buildThreadItems({
      messages: [message('a', 0, undefined, 'alice'), message('b', 1, undefined, 'bob')],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({ message: { id: 'b' }, groupedWithPrevious: false });
  });

  it('does not stack same-sender messages separated by a membership event', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 1)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [event('e', 1)],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['timestamp', 'a', 'e', 'b']);
    expect(items[3]).toMatchObject({ message: { id: 'b' }, groupedWithPrevious: false });
  });

  it('does not stack same-sender messages once the gap earns extra spacing', () => {
    const items = buildThreadItems({
      messages: [message('a', 0), message('b', 25)],
      decrypted: decrypted({ a: 'ok', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({ message: { id: 'b' }, gapBefore: true, groupedWithPrevious: false });
  });

  it('never stacks the conversation-started row with a real message', () => {
    const items = buildThreadItems({
      messages: [message('s', 0, 'SYSTEM'), message('a', 1)],
      decrypted: decrypted({ a: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    const real = items.find((i) => i.kind === 'message' && i.message.id === 'a');
    expect(real).toMatchObject({ groupedWithPrevious: false });
  });
});

describe('membershipEventText', () => {
  const base = event('e', 1);

  it('words each kind, falling back for an unknown name', () => {
    expect(membershipEventText(base, 'Bob', false)).toBe('Bob joined the group');
    expect(membershipEventText({ ...base, kind: 'left' }, undefined, false)).toBe(
      'A member left or was removed from the group',
    );
    expect(membershipEventText({ ...base, kind: 'device-added' }, undefined, true)).toBe(
      'You signed in on a new device',
    );
  });
});

describe('threadItemKey', () => {
  it('keys each row kind by its own id', () => {
    expect(threadItemKey({ kind: 'history-banner' })).toBe('history-banner');
    expect(
      threadItemKey({
        kind: 'message',
        message: message('m1', 0),
        index: 0,
        gapBefore: false,
        groupedWithPrevious: false,
        groupedWithNext: false,
      }),
    ).toBe('m1');
    expect(threadItemKey({ kind: 'timestamp', at: 123 })).toBe('timestamp-123');
  });
});

// Local-time constructors, not UTC ISO strings: getHours()/toLocaleDateString() read the
// system's local clock, so a fixed UTC instant would shift with the machine's timezone.
describe('messageDividerLabel', () => {
  const now = new Date(2026, 8, 28, 15, 0).getTime();

  it('shows only the time for a message sent today', () => {
    expect(messageDividerLabel(new Date(2026, 8, 28, 9, 5).getTime(), now, 'en-US')).toBe('09:05');
  });

  it('shows the weekday and time within the past 6 days', () => {
    expect(messageDividerLabel(new Date(2026, 8, 23, 21, 13).getTime(), now, 'en-US')).toBe(
      'Wed 21:13',
    );
  });

  it('shows the full date and time once older than a week', () => {
    expect(messageDividerLabel(new Date(2026, 8, 16, 14, 40).getTime(), now, 'en-US')).toBe(
      '16 Sep 2026, 14:40',
    );
  });
});

describe('messageFullTimestamp', () => {
  it('always spells out the full date', () => {
    expect(messageFullTimestamp(new Date(2026, 8, 16, 14, 40).getTime(), 'en-US')).toBe(
      '16 September 2026, 14:40',
    );
  });
});

describe('withOptimisticDelete', () => {
  it('marks only the matching message deleted, leaving others untouched', () => {
    const messages = [{ id: 'a', status: 'SENT' }, { id: 'b', status: 'SENT' }];
    const result = withOptimisticDelete(messages, 'a');
    expect(result).toEqual([{ id: 'a', status: 'DELETED' }, { id: 'b', status: 'SENT' }]);
    expect(result[1]).toBe(messages[1]);
  });
});

describe('replyOriginalSenderLabel', () => {
  it('says "You" when someone else replies to a message the viewer wrote', () => {
    expect(replyOriginalSenderLabel('bob', 'me', 'me', 'Me')).toBe('You');
  });

  it('says "yourself" when the viewer replies to their own earlier message', () => {
    expect(replyOriginalSenderLabel('me', 'me', 'me', 'Me')).toBe('yourself');
  });

  it('says "themself" when someone else replies to their own earlier message', () => {
    expect(replyOriginalSenderLabel('bob', 'bob', 'me', 'Bob')).toBe('themself');
  });

  it('names the original sender when neither the replier nor the viewer wrote it', () => {
    expect(replyOriginalSenderLabel('bob', 'carol', 'me', 'Carol')).toBe('Carol');
  });

  it('falls back to a plain label once the sender or name is unknown', () => {
    expect(replyOriginalSenderLabel('bob', undefined, 'me', undefined)).toBe('a message');
    expect(replyOriginalSenderLabel('bob', 'carol', 'me', undefined)).toBe('a message');
  });
});

describe('readableNeighbors / wasLikelySentDuringAbsence', () => {
  const messages = [message('a', 0), message('b', 1), message('c', 2)];

  it('is true only when readable messages sit on both sides', () => {
    const withBothSidesOk = readableNeighbors(messages, decrypted({ a: 'ok', b: 'unavailable', c: 'ok' }));
    expect(wasLikelySentDuringAbsence(withBothSidesOk, 1)).toBe(true);

    const withNeitherSideOk = readableNeighbors(
      messages,
      decrypted({ a: 'unavailable', b: 'unavailable', c: 'ok' }),
    );
    expect(wasLikelySentDuringAbsence(withNeitherSideOk, 1)).toBe(false);
  });

  it('is false at either end of the thread, with nothing on one side', () => {
    const neighbors = readableNeighbors(messages, decrypted({ a: 'ok', b: 'ok', c: 'unavailable' }));
    expect(wasLikelySentDuringAbsence(neighbors, 0)).toBe(false);
    expect(wasLikelySentDuringAbsence(neighbors, 2)).toBe(false);
  });
});
