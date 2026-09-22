import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { MlsSelfJoinRateLimiterService } from './mls-self-join-rate-limiter.service';

describe('MlsSelfJoinRateLimiterService', () => {
  let limiter: MlsSelfJoinRateLimiterService;

  beforeEach(() => {
    limiter = new MlsSelfJoinRateLimiterService();
  });

  it('lets a user join a few groups, then makes them wait', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(() => limiter.assertMayJoin('user-1')).not.toThrow();
    }

    expect(() => limiter.assertMayJoin('user-1')).toThrow(RateLimitedException);
    expect(() => limiter.assertMayJoin('user-2')).not.toThrow();
  });

  it('caps snapshot fetches separately, with a higher ceiling', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(() => limiter.assertMayFetchGroupInfo('user-1')).not.toThrow();
    }

    expect(() => limiter.assertMayFetchGroupInfo('user-1')).toThrow(
      RateLimitedException,
    );
    expect(() => limiter.assertMayJoin('user-1')).not.toThrow();
  });
});
