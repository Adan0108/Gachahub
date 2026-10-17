import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

/** How fast one person can post in one room, on top of a channel's own slow mode. */
@Injectable()
export class CommunityChatRateLimiterService {
  private readonly limiter = new SlidingWindowRateLimiter({
    windowMs: 5000,
    maxPerWindow: 5,
    lockoutMs: 5000,
    maxTrackedKeys: 10000,
    message: 'You are sending messages too fast, please slow down',
  });

  assertNotRateLimited(userId: string, channelId: string): void {
    this.limiter.assertNotRateLimited(`${userId}:${channelId}`);
  }
}
