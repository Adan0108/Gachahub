import { RateLimitedException } from '../exceptions/rate-limited.exception';
import {
  perMinutePerUserLimiter,
  SlidingWindowRateLimiter,
} from './sliding-window-rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  const capture = (fn: () => void): RateLimitedException => {
    try {
      fn();
    } catch (error) {
      return error as RateLimitedException;
    }
    throw new Error('expected a rate limit');
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('without a lockout', () => {
    const make = () =>
      new SlidingWindowRateLimiter({
        windowMs: 60_000,
        maxPerWindow: 2,
        maxTrackedKeys: 3,
        message: 'slow down',
      });

    it('rejects past the cap with the time until the oldest hit expires, until the window slides', () => {
      const limiter = make();
      limiter.assertNotRateLimited('a');
      jest.setSystemTime(20_000);
      limiter.assertNotRateLimited('a');

      const error = capture(() => limiter.assertNotRateLimited('a'));
      expect(error.retryAfterSeconds).toBe(40);
      expect(error.message).toBe('slow down');

      jest.setSystemTime(60_001);
      expect(() => limiter.assertNotRateLimited('a')).not.toThrow();
    });

    it('falls back to the full window when a single cost exceeds the cap on its own', () => {
      const limiter = make();

      expect(
        capture(() => limiter.assertNotRateLimited('a', 3)).retryAfterSeconds,
      ).toBe(60);
    });

    it('does not count a rejected attempt', () => {
      const limiter = make();
      limiter.assertNotRateLimited('a');
      limiter.assertNotRateLimited('a');
      capture(() => limiter.assertNotRateLimited('a'));
      capture(() => limiter.assertNotRateLimited('a'));

      jest.setSystemTime(60_001);
      limiter.assertNotRateLimited('a');
      limiter.assertNotRateLimited('a');
      expect(() => limiter.assertNotRateLimited('a')).toThrow();
    });

    it('counts a cost as that many attempts', () => {
      const limiter = make();

      expect(() => limiter.assertNotRateLimited('a', 3)).toThrow(
        RateLimitedException,
      );
    });

    it('waits until enough hits age out to fit a cost above one', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60_000,
        maxPerWindow: 4,
        maxTrackedKeys: 3,
        message: 'slow down',
      });
      limiter.assertNotRateLimited('a');
      jest.setSystemTime(10_000);
      limiter.assertNotRateLimited('a');
      jest.setSystemTime(20_000);
      limiter.assertNotRateLimited('a', 2);

      // Cost 2 needs two of the four hits gone: the ones at 0 and 10s.
      expect(
        capture(() => limiter.assertNotRateLimited('a', 2)).retryAfterSeconds,
      ).toBe(50);
    });

    it('tryConsume returns false instead of throwing, and records only successes', () => {
      const limiter = make();

      expect(limiter.tryConsume('a')).toBe(true);
      expect(limiter.tryConsume('a')).toBe(true);
      expect(limiter.tryConsume('a')).toBe(false);
      expect(limiter.tryConsume('a', 3)).toBe(false);

      jest.setSystemTime(60_001);
      expect(limiter.tryConsume('a')).toBe(true);
    });

    it('evicts the least recently used key at capacity', () => {
      const limiter = make();
      ['a', 'b', 'c', 'd', 'e'].forEach((key) =>
        limiter.assertNotRateLimited(key),
      );

      expect(limiter.trackedKeyCount).toBe(3);
    });
  });

  describe('with a lockout', () => {
    const make = () =>
      new SlidingWindowRateLimiter({
        windowMs: 5000,
        maxPerWindow: 2,
        lockoutMs: 8000,
        maxTrackedKeys: 100,
        message: 'locked',
      });

    const lockOut = (limiter: SlidingWindowRateLimiter) => {
      limiter.assertNotRateLimited('a');
      limiter.assertNotRateLimited('a');
      capture(() => limiter.assertNotRateLimited('a'));
    };

    it('reports the full lockout when the cap is crossed', () => {
      const limiter = make();
      limiter.assertNotRateLimited('a');
      limiter.assertNotRateLimited('a');

      expect(
        capture(() => limiter.assertNotRateLimited('a')).retryAfterSeconds,
      ).toBe(8);
    });

    it('keeps rejecting for the whole lockout and reports the time left', () => {
      const limiter = make();
      lockOut(limiter);

      jest.setSystemTime(3000);
      expect(
        capture(() => limiter.assertNotRateLimited('a')).retryAfterSeconds,
      ).toBe(5);

      jest.setSystemTime(7999);
      expect(() => limiter.assertNotRateLimited('a')).toThrow();
    });

    it('starts a fresh window once the lockout ends, without recounting the old one', () => {
      const limiter = make();
      lockOut(limiter);

      jest.setSystemTime(8001);
      limiter.assertNotRateLimited('a');
      limiter.assertNotRateLimited('a');
      expect(() => limiter.assertNotRateLimited('a')).toThrow();
    });

    it('locks out per key', () => {
      const limiter = make();
      lockOut(limiter);

      expect(() => limiter.assertNotRateLimited('b')).not.toThrow();
    });
  });
});

describe('perMinutePerUserLimiter', () => {
  it('caps per key per minute', () => {
    const limiter = perMinutePerUserLimiter(1, 'slow down');
    limiter.assertNotRateLimited('a');

    expect(() => limiter.assertNotRateLimited('a')).toThrow(
      RateLimitedException,
    );
    expect(() => limiter.assertNotRateLimited('b')).not.toThrow();
  });
});
