import { HttpException, HttpStatus } from '@nestjs/common';
import { ReportRateLimiterService } from './report-rate-limiter.service';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

describe('ReportRateLimiterService', () => {
  let service: ReportRateLimiterService;

  const captureError = (fn: () => void): HttpException => {
    try {
      fn();
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected assertNotRateLimited to throw');
  };

  // files 6 reports for userId to push them past the cap and into a
  // lockout - the 6th call is expected to throw, so swallow it here rather
  // than let it fail whichever test uses this as its setup step
  const triggerLockout = (userId: string): void => {
    for (let i = 0; i < 5; i++) {
      service.assertNotRateLimited(userId);
    }
    captureError(() => service.assertNotRateLimited(userId));
  };

  beforeEach(() => {
    service = new ReportRateLimiterService();
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first report', () => {
    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('allows up to the per-window cap', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
    }
  });

  it('rejects the report that crosses the cap with a 429', () => {
    for (let i = 0; i < 5; i++) {
      service.assertNotRateLimited('user-1');
    }

    const error = captureError(() => service.assertNotRateLimited('user-1'));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('reports the full lockout length as retryAfterSeconds when the cap is crossed', () => {
    for (let i = 0; i < 5; i++) {
      service.assertNotRateLimited('user-1');
    }

    const error = captureError(() => service.assertNotRateLimited('user-1'));

    expect(error).toBeInstanceOf(RateLimitedException);
    expect((error as RateLimitedException).retryAfterSeconds).toBe(60);
  });

  it('keeps rejecting for the whole lockout, even well under the window cap', () => {
    triggerLockout('user-1');

    jest.setSystemTime(59_999);

    expect(() => service.assertNotRateLimited('user-1')).toThrow(HttpException);
  });

  it('allows filing again once the lockout expires', () => {
    triggerLockout('user-1');

    jest.setSystemTime(120_001);

    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('does not count reports outside the sliding window', () => {
    for (let i = 0; i < 5; i++) {
      service.assertNotRateLimited('user-1');
    }

    jest.setSystemTime(60_001);

    // the first 5 timestamps are now outside the 60s window, so this is
    // effectively report 1 of a new window, not report 6 of the old one
    expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
  });

  it('rate limits per user, not globally', () => {
    triggerLockout('user-1');

    expect(() => service.assertNotRateLimited('user-2')).not.toThrow();
  });

  it('keeps the tracked-user map bounded instead of growing forever', () => {
    for (let i = 0; i < 10_001; i++) {
      service.assertNotRateLimited(`user-${i}`);
    }

    const recentReports = (
      service as unknown as { recentReports: Map<string, number[]> }
    ).recentReports;

    expect(recentReports.size).toBeLessThanOrEqual(10_000);
  });
});
