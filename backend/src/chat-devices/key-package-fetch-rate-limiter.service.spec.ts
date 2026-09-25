import { KeyPackageFetchRateLimiterService } from './key-package-fetch-rate-limiter.service';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

describe('KeyPackageFetchRateLimiterService', () => {
  let limiter: KeyPackageFetchRateLimiterService;

  beforeEach(() => {
    limiter = new KeyPackageFetchRateLimiterService();
  });

  it('allows fetches under both limits', () => {
    expect(() =>
      limiter.assertNotRateLimited('requester-1', 'target-1'),
    ).not.toThrow();
  });

  it('rate limits a single requester hammering one target', () => {
    for (let i = 0; i < 20; i += 1) {
      limiter.assertNotRateLimited('requester-1', `target-${i}`);
    }

    expect(() =>
      limiter.assertNotRateLimited('requester-1', 'target-21'),
    ).toThrow(RateLimitedException);
  });

  // regression: many distinct requesters could previously drain one target's
  // key packages, since only the requester side was ever rate-limited
  it('rate limits many distinct requesters targeting the same victim', () => {
    for (let i = 0; i < 60; i += 1) {
      limiter.assertNotRateLimited(`requester-${i}`, 'victim');
    }

    expect(() =>
      limiter.assertNotRateLimited('requester-61', 'victim'),
    ).toThrow(RateLimitedException);
  });

  it('does not let a hot target throttle unrelated requester/target pairs', () => {
    for (let i = 0; i < 60; i += 1) {
      limiter.assertNotRateLimited(`requester-${i}`, 'victim');
    }

    expect(() =>
      limiter.assertNotRateLimited('someone-else', 'a-different-user'),
    ).not.toThrow();
  });

  describe('cost', () => {
    it('counts a request that hands out several packages as that many fetches', () => {
      // 6 requests x 3 packages = 18, then 2 more single fetches reach the limit of 20
      for (let i = 0; i < 6; i += 1) {
        limiter.assertNotRateLimited('requester-1', `target-${i}`, 3);
      }
      limiter.assertNotRateLimited('requester-1', 'target-x');
      limiter.assertNotRateLimited('requester-1', 'target-y');

      expect(() =>
        limiter.assertNotRateLimited('requester-1', 'target-z'),
      ).toThrow(RateLimitedException);
    });

    it('refuses one request whose cost alone exceeds the limit', () => {
      expect(() =>
        limiter.assertNotRateLimited('requester-1', 'target-1', 21),
      ).toThrow(RateLimitedException);
    });

    it('counts the cost against the target too', () => {
      for (let i = 0; i < 20; i += 1) {
        limiter.assertNotRateLimited(`requester-${i}`, 'victim', 3);
      }

      expect(() =>
        limiter.assertNotRateLimited('requester-99', 'victim'),
      ).toThrow(RateLimitedException);
    });
  });
});
