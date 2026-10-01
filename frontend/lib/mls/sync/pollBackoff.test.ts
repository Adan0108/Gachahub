import { describe, expect, it } from 'vitest';
import { MAX_POLL_DELAY_MS, pollDelayMs } from './pollBackoff';
import { readPage } from './pagedResponse';

describe('pollDelayMs', () => {
  it('keeps the base interval while healthy', () => {
    expect(pollDelayMs(5000, 0)).toBe(5000);
  });

  it('doubles per consecutive error and caps at 60s', () => {
    const full = () => 1;
    expect(pollDelayMs(5000, 1, full)).toBe(10_000);
    expect(pollDelayMs(5000, 2, full)).toBe(20_000);
    expect(pollDelayMs(5000, 10, full)).toBe(MAX_POLL_DELAY_MS);
  });

  it('jitters downward once failing', () => {
    expect(pollDelayMs(5000, 1, () => 0)).toBe(7500);
  });
});

describe('readPage', () => {
  it('reads a bare array as a single page', () => {
    expect(readPage([1, 2], 'welcomes')).toEqual({ items: [1, 2], hasMore: false, nextCursor: undefined });
  });

  it('reads items or the legacy key, with hasMore and nextCursor', () => {
    expect(readPage({ items: [1], hasMore: true, nextCursor: 'c' }, 'welcomes')).toEqual({
      items: [1],
      hasMore: true,
      nextCursor: 'c',
    });
    expect(readPage({ welcomes: [2] }, 'welcomes').items).toEqual([2]);
  });

  it('treats anything else as an empty page', () => {
    expect(readPage(null, 'welcomes').items).toEqual([]);
  });
});

describe('readPage with a full-page size', () => {
  it('treats a full bare-array page as having more, and a short one as done', () => {
    expect(readPage([1, 2, 3], 'handshakes', 3).hasMore).toBe(true);
    expect(readPage([1, 2], 'handshakes', 3).hasMore).toBe(false);
    expect(readPage([1, 2, 3], 'handshakes').hasMore).toBe(false);
  });
});

describe('readPage cursor for a full bare-array page', () => {
  it('uses the last item id as the cursor, and none for a short page', () => {
    expect(readPage([{ id: 'a' }, { id: 'b' }], 'welcomes', 2).nextCursor).toBe('b');
    expect(readPage([{ id: 'a' }], 'welcomes', 2).nextCursor).toBeUndefined();
  });
});
