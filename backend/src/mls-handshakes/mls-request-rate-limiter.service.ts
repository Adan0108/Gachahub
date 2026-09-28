import { Injectable } from '@nestjs/common';
import { perMinutePerUserLimiter } from '../common/utils/sliding-window-rate-limiter';

/** Per-user caps on the MLS endpoints a device hits, well above honest use. */
@Injectable()
export class MlsRequestRateLimiterService {
  private readonly submitLimiter = perMinutePerUserLimiter(
    60,
    'You are submitting commits too fast, please slow down',
  );

  private readonly workLimiter = perMinutePerUserLimiter(
    120,
    'You are asking for membership work too fast, please slow down',
  );

  private readonly pendingLimiter = perMinutePerUserLimiter(
    300,
    'You are checking for pending MLS work too fast, please slow down',
  );

  private readonly rosterLimiter = perMinutePerUserLimiter(
    240,
    'You are fetching group rosters too fast, please slow down',
  );

  assertMaySubmitHandshake(userId: string): void {
    this.submitLimiter.assertNotRateLimited(userId);
  }

  assertMayTakeMembershipWork(userId: string): void {
    this.workLimiter.assertNotRateLimited(userId);
  }

  /** Covers the pending summary, pending welcomes and joinable conversations. */
  assertMayPollPending(userId: string): void {
    this.pendingLimiter.assertNotRateLimited(userId);
  }

  assertMayFetchRoster(userId: string): void {
    this.rosterLimiter.assertNotRateLimited(userId);
  }
}
