import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

/**
 * Per-user limits on joining groups by yourself. Fetching a snapshot is cheap
 * but enumerable; a join advances a group's epoch, so it gets a tighter cap.
 */
@Injectable()
export class MlsSelfJoinRateLimiterService {
  private readonly fetchLimiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 30,
    maxTrackedKeys: 10000,
    message: 'You are fetching group snapshots too fast, please slow down',
  });

  private readonly joinLimiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 10,
    maxTrackedKeys: 10000,
    message: 'You are joining groups too fast, please slow down',
  });

  assertMayFetchGroupInfo(userId: string): void {
    this.fetchLimiter.assertNotRateLimited(userId);
  }

  assertMayJoin(userId: string): void {
    this.joinLimiter.assertNotRateLimited(userId);
  }
}
