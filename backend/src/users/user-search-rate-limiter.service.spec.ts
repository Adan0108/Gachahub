import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';

describe('UserSearchRateLimiterService', () => {
  it('allows 30 searches a minute per caller, then rejects, independently per caller', () => {
    const limiter = new UserSearchRateLimiterService();

    for (let i = 0; i < 30; i += 1) {
      limiter.assertNotRateLimited('a');
    }

    expect(() => limiter.assertNotRateLimited('a')).toThrow();
    expect(() => limiter.assertNotRateLimited('b')).not.toThrow();
  });
});
