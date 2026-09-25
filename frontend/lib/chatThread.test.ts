import { describe, expect, it } from 'vitest';
import {
  buildThreadItems,
  membershipEventText,
  threadItemKey,
  wasLikelySentDuringAbsence,
} from './chatThread';
import type { MembershipEvent } from './mls/sync/membershipEvents';

type Status = 'ok' | 'unavailable' | 'pending';
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const message = (id: string, minute: number, contentType?: string) => ({
  id,
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

describe('buildThreadItems', () => {
  it('collapses leading undecryptable messages into one banner', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2), message('c', 3)],
      decrypted: decrypted({ a: 'unavailable', b: 'unavailable', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['history-banner', 'c']);
  });

  it('keeps an undecryptable message that follows a readable one', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2), message('c', 3)],
      decrypted: decrypted({ a: 'ok', b: 'unavailable', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['a', 'b', 'c']);
  });

  it('steps over the conversation-started row and pending messages while collapsing', () => {
    const items = buildThreadItems({
      messages: [message('s', 0, 'SYSTEM'), message('a', 1), message('p', 2), message('c', 3)],
      decrypted: decrypted({ a: 'unavailable', p: 'pending', c: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['history-banner', 's', 'p', 'c']);
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
    expect(shape(allOk)).toEqual(['a', 'b']);
    expect(shape(uncollapsed)).toEqual(['a', 'b']);
  });

  it('places events by time among messages, before a message with the same time', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 5), message('c', 9)],
      decrypted: decrypted({ a: 'ok', b: 'ok', c: 'ok' }),
      events: [event('late', 20), event('tie', 5), event('mid', 3)],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(['a', 'mid', 'tie', 'b', 'c', 'late']);
  });

  it('records each message index in the original list', () => {
    const items = buildThreadItems({
      messages: [message('a', 1), message('b', 2)],
      decrypted: decrypted({ a: 'unavailable', b: 'ok' }),
      events: [],
      collapseLeading: true,
    });
    expect(items[1]).toMatchObject({ kind: 'message', index: 1 });
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
    expect(threadItemKey({ kind: 'message', message: message('m1', 0), index: 0 })).toBe('m1');
  });
});

describe('wasLikelySentDuringAbsence', () => {
  const messages = [message('a', 0), message('b', 1), message('c', 2)];

  it('is true only when readable messages sit on both sides', () => {
    expect(wasLikelySentDuringAbsence(messages, decrypted({ a: 'ok', b: 'unavailable', c: 'ok' }), 1)).toBe(true);
    expect(wasLikelySentDuringAbsence(messages, decrypted({ a: 'unavailable', b: 'unavailable', c: 'ok' }), 1)).toBe(false);
  });
});
