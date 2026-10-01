import { HttpException, HttpStatus } from '@nestjs/common';
import { ChatHistoryFetchRateLimiterService } from './chat-history-fetch-rate-limiter.service';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

describe('ChatHistoryFetchRateLimiterService', () => {
  let service: ChatHistoryFetchRateLimiterService;

  const conversationId = 'conv-1';
  const fetch = (userId: string, conversation = conversationId) =>
    service.assertNotRateLimited(userId, conversation);

  const captureError = (fn: () => void): HttpException => {
    try {
      fn();
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected assertNotRateLimited to throw');
  };

  // fetches 4 pages for userId to push them past the cap and into a
  // lockout - the 4th call is expected to throw, so swallow it here rather
  // than let it fail whichever test uses this as its setup step
  const triggerLockout = (userId: string): void => {
    for (let i = 0; i < 3; i++) {
      fetch(userId);
    }
    captureError(() => fetch(userId));
  };

  beforeEach(() => {
    service = new ChatHistoryFetchRateLimiterService();
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first page fetch', () => {
    expect(() => fetch('user-1')).not.toThrow();
  });

  it('allows up to the per-window cap', () => {
    for (let i = 0; i < 3; i++) {
      expect(() => fetch('user-1')).not.toThrow();
    }
  });

  it('rejects the fetch that crosses the cap with a 429', () => {
    for (let i = 0; i < 3; i++) {
      fetch('user-1');
    }

    const error = captureError(() => fetch('user-1'));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('reports the full lockout length as retryAfterSeconds when the cap is crossed', () => {
    for (let i = 0; i < 3; i++) {
      fetch('user-1');
    }

    const error = captureError(() => fetch('user-1'));

    expect(error).toBeInstanceOf(RateLimitedException);
    expect((error as RateLimitedException).retryAfterSeconds).toBe(8);
  });

  it('reports the time left in the lockout as retryAfterSeconds on repeat attempts', () => {
    triggerLockout('user-1');

    jest.setSystemTime(3000);

    const error = captureError(() => fetch('user-1'));

    expect((error as RateLimitedException).retryAfterSeconds).toBe(5);
  });

  it('keeps rejecting for the whole lockout, even well under the window cap', () => {
    triggerLockout('user-1');

    jest.setSystemTime(7999);

    expect(() => fetch('user-1')).toThrow(HttpException);
  });

  it('allows fetching again once the lockout expires', () => {
    triggerLockout('user-1');

    jest.setSystemTime(8001);

    expect(() => fetch('user-1')).not.toThrow();
  });

  it('does not count fetches outside the sliding window', () => {
    for (let i = 0; i < 3; i++) {
      fetch('user-1');
    }

    jest.setSystemTime(10001);

    // the first 3 timestamps are now outside the 10s window, so this is
    // effectively fetch 1 of a new window, not fetch 4 of the old one
    expect(() => fetch('user-1')).not.toThrow();
  });

  it('rate limits per user, not globally', () => {
    triggerLockout('user-1');

    expect(() => fetch('user-2')).not.toThrow();
  });

  it("rate limits per conversation, not across a user's whole account - a busy conversation should not spend a completely different one's budget", () => {
    triggerLockout('user-1');

    expect(() => fetch('user-1', 'conv-2')).not.toThrow();
  });

  it('keeps the tracked-conversation map bounded instead of growing forever', () => {
    for (let i = 0; i < 10001; i++) {
      fetch(`user-${i}`);
    }

    const { limiter } = service as unknown as {
      limiter: { trackedKeyCount: number };
    };

    expect(limiter.trackedKeyCount).toBeLessThanOrEqual(10000);
  });
});
