import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { MlsFaultReportRateLimiterService } from './mls-fault-report-rate-limiter.service';

describe('MlsFaultReportRateLimiterService', () => {
  it('allows a burst of reports per user, then makes that user wait', () => {
    const limiter = new MlsFaultReportRateLimiterService();

    for (let i = 0; i < 60; i += 1) {
      expect(() => limiter.assertMayReport('user-1')).not.toThrow();
    }

    expect(() => limiter.assertMayReport('user-1')).toThrow(
      RateLimitedException,
    );
    expect(() => limiter.assertMayReport('user-2')).not.toThrow();
  });

  it('budgets three snapshot deletions per conversation per hour, independently per conversation', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const limiter = new MlsFaultReportRateLimiterService();

    expect(
      [1, 2, 3, 4].map(() => limiter.tryConsumeSnapshotDeletion('conv-1')),
    ).toEqual([true, true, true, false]);
    expect(limiter.tryConsumeSnapshotDeletion('conv-2')).toBe(true);

    jest.setSystemTime(60 * 60_000 + 1);
    expect(limiter.tryConsumeSnapshotDeletion('conv-1')).toBe(true);
    jest.useRealTimers();
  });
});
