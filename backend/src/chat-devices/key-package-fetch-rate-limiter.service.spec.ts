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
});
