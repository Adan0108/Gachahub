import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

@Injectable()
export class UserSearchRateLimiterService {
  private readonly limiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 30,
    maxTrackedKeys: 10000,
    message: 'You are searching too fast, please slow down',
  });

  assertNotRateLimited(callerId: string): void {
    this.limiter.assertNotRateLimited(callerId);
  }
}
