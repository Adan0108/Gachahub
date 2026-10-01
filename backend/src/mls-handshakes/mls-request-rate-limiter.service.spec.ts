import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';

describe('MlsRequestRateLimiterService', () => {
  let limiter: MlsRequestRateLimiterService;

  beforeEach(() => {
    limiter = new MlsRequestRateLimiterService();
  });

  const cases: Array<[string, (user: string) => void, number]> = [
    ['submitting commits', (u) => limiter.assertMaySubmitHandshake(u), 60],
    [
      'taking membership work',
      (u) => limiter.assertMayTakeMembershipWork(u),
      120,
    ],
    ['polling for pending work', (u) => limiter.assertMayPollPending(u), 300],
    ['fetching rosters', (u) => limiter.assertMayFetchRoster(u), 240],
  ];

  it.each(cases)(
    'caps %s per user at its ceiling',
    (_name, assertAllowed, ceiling) => {
      for (let i = 0; i < ceiling; i += 1) {
        expect(() => assertAllowed('user-1')).not.toThrow();
      }

      expect(() => assertAllowed('user-1')).toThrow(RateLimitedException);
      expect(() => assertAllowed('user-2')).not.toThrow();
    },
  );

  it('counts each endpoint group on its own', () => {
    for (let i = 0; i < 60; i += 1) limiter.assertMaySubmitHandshake('user-1');

    expect(() => limiter.assertMayFetchRoster('user-1')).not.toThrow();
    expect(() => limiter.assertMayPollPending('user-1')).not.toThrow();
  });
});
