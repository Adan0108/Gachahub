import { describe, expect, it } from 'vitest';
import { resolveThreadHits, wrapPosition } from './searchResults';

const hit = (messageId: string, text = `text of ${messageId}`) => ({ messageId, conversationId: 'c1', text });
const message = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  senderId: 'peer',
  createdAt,
  ...extra,
});

const loaded = (...messages: ReturnType<typeof message>[]) => new Map(messages.map((entry) => [entry.id, entry]));

describe('resolveThreadHits', () => {
  it('lists matches newest first with who sent them and when', () => {
    const { results } = resolveThreadHits(
      [hit('a'), hit('b'), hit('c')],
      loaded(
        message('a', '2026-10-01T10:00:00.000Z'),
        message('b', '2026-10-03T10:00:00.000Z', { senderId: 'me' }),
        message('c', '2026-10-02T10:00:00.000Z'),
      ),
      new Set(),
    );

    expect(results.map((result) => result.messageId)).toEqual(['b', 'c', 'a']);
    expect(results[0]).toMatchObject({ senderId: 'me', createdAt: '2026-10-03T10:00:00.000Z' });
  });

  it('keeps the text and the send time of each match', () => {
    const { results } = resolveThreadHits(
      [hit('a', 'see you at the cafe')],
      loaded(message('a', '2026-10-01T10:00:00.000Z')),
      new Set(),
    );

    expect(results[0]).toMatchObject({ text: 'see you at the cafe', sentAt: Date.parse('2026-10-01T10:00:00.000Z') });
  });

  it('puts a message with no usable time last instead of scrambling the order', () => {
    const { results } = resolveThreadHits(
      [hit('a'), hit('b'), hit('c')],
      loaded(
        message('a', 'not a date'),
        message('b', '2026-10-02T10:00:00.000Z'),
        message('c', '2026-10-01T10:00:00.000Z'),
      ),
      new Set(),
    );

    expect(results.map((result) => result.messageId)).toEqual(['b', 'c', 'a']);
  });

  it('leaves out unsent messages and ones you hid for yourself', () => {
    const { results, olderCount } = resolveThreadHits(
      [hit('a'), hit('b'), hit('c')],
      loaded(
        message('a', '2026-10-01T10:00:00.000Z', { status: 'DELETED' }),
        message('b', '2026-10-02T10:00:00.000Z'),
        message('c', '2026-10-03T10:00:00.000Z'),
      ),
      new Set(['b']),
    );

    expect(results.map((result) => result.messageId)).toEqual(['c']);
    expect(olderCount).toBe(0);
  });

  it('counts matches in messages the thread has not loaded instead of listing them', () => {
    const { results, olderCount } = resolveThreadHits(
      [hit('a'), hit('old1'), hit('old2')],
      loaded(message('a', '2026-10-01T10:00:00.000Z')),
      new Set(),
    );

    expect(results.map((result) => result.messageId)).toEqual(['a']);
    expect(olderCount).toBe(2);
  });

  it('is empty without hits', () => {
    expect(resolveThreadHits([], new Map(), new Set())).toEqual({ results: [], olderCount: 0 });
  });
});

describe('wrapPosition', () => {
  it('leaves a position inside the list alone', () => {
    expect(wrapPosition(0, 3)).toBe(0);
    expect(wrapPosition(2, 3)).toBe(2);
  });

  it('loops past either end, however far', () => {
    expect(wrapPosition(3, 3)).toBe(0);
    expect(wrapPosition(-1, 3)).toBe(2);
    expect(wrapPosition(-4, 3)).toBe(2);
    expect(wrapPosition(7, 3)).toBe(1);
  });

  it('is always 0 for a one-item list', () => {
    expect(wrapPosition(-2, 1) === 0).toBe(true);
    expect(wrapPosition(5, 1)).toBe(0);
  });
});
