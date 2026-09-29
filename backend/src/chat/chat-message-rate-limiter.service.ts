import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

/**
 * Rate limit how fast one user can send chat messages
 */
@Injectable()
export class ChatMessageRateLimiterService {
  private readonly limiter = new SlidingWindowRateLimiter({
    windowMs: 5000,
    maxPerWindow: 6,
    lockoutMs: 5000,
    maxTrackedKeys: 10000,
    message: 'You are sending messages too fast, please slow down',
  });

  /**
   * Throw 429 if user is currently rate-limited, otherwise records the send
   */
  assertNotRateLimited(userId: string): void {
    this.limiter.assertNotRateLimited(userId);
  }
}
