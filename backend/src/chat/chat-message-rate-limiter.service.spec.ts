import { HttpException, HttpStatus } from '@nestjs/common';
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

describe('ChatMessageRateLimiterService', () => {
  let service: ChatMessageRateLimiterService;

  const captureError = (fn: () => void): HttpException => {
    try {
      fn();
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected assertNotRateLimited to throw');
  };

  // sends 7 messages for userId to push them past the cap and into a
  // lockout - the 7th call is expected to throw, so swallow it here rather
  // than let it fail whichever test uses this as its setup step
  const triggerLockout = (userId: string): void => {
    for (let i = 0; i < 6; i++) {
      service.assertNotRateLimited(userId);
    }
    captureError(() => service.assertNotRateLimited(userId));
  };

  beforeEach(() => {
    service = new ChatMessageRateLimiterService();
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first message', () => {
    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('allows up to the per-window cap', () => {
    for (let i = 0; i < 6; i++) {
      expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
    }
  });

  it('rejects the message that crosses the cap with a 429', () => {
    for (let i = 0; i < 6; i++) {
      service.assertNotRateLimited('user-1');
    }

    const error = captureError(() => service.assertNotRateLimited('user-1'));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('reports the full lockout length as retryAfterSeconds when the cap is crossed', () => {
    for (let i = 0; i < 6; i++) {
      service.assertNotRateLimited('user-1');
    }

    const error = captureError(() => service.assertNotRateLimited('user-1'));

    expect(error).toBeInstanceOf(RateLimitedException);
    expect((error as RateLimitedException).retryAfterSeconds).toBe(5);
  });

  it('reports the time left in the lockout as retryAfterSeconds on repeat attempts', () => {
    triggerLockout('user-1');

    jest.setSystemTime(3000);

    const error = captureError(() => service.assertNotRateLimited('user-1'));

    expect((error as RateLimitedException).retryAfterSeconds).toBe(2);
  });

  it('keeps rejecting for the whole lockout, even well under the window cap', () => {
    triggerLockout('user-1');

    jest.setSystemTime(4999);

    expect(() => service.assertNotRateLimited('user-1')).toThrow(HttpException);
  });

  it('allows sending again once the lockout expires', () => {
    triggerLockout('user-1');

    jest.setSystemTime(10001);

    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('does not count messages outside the sliding window', () => {
    for (let i = 0; i < 6; i++) {
      service.assertNotRateLimited('user-1');
    }

    jest.setSystemTime(5001);

    // the first 6 timestamps are now outside the 5s window, so this is
    // effectively message 1 of a new window, not message 7 of the old one
    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('rate limits per user, not globally', () => {
    triggerLockout('user-1');

    expect(() => service.assertNotRateLimited('user-2')).not.toThrow();
  });

  it('keeps the tracked-user map bounded instead of growing forever', () => {
    for (let i = 0; i < 10001; i++) {
      service.assertNotRateLimited(`user-${i}`);
    }

    const recentSends = (
      service as unknown as { recentSends: Map<string, number[]> }
    ).recentSends;

    expect(recentSends.size).toBeLessThanOrEqual(10000);
  });
});
