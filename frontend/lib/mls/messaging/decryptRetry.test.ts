import { describe, expect, it } from 'vitest';
import { nextRetryDelayMs } from './decryptRetry';

describe('nextRetryDelayMs', () => {
  it('doubles each attempt, starting at 5 seconds', () => {
    expect([0, 1, 2, 3].map(nextRetryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
  });

  it('never waits more than a minute', () => {
    expect(nextRetryDelayMs(4)).toBe(60_000);
    expect(nextRetryDelayMs(50)).toBe(60_000);
  });
});
