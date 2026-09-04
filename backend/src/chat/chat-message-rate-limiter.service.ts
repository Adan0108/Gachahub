import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Rate limit how fast one user can send chat messages
 */
@Injectable()
export class ChatMessageRateLimiterService {
  private readonly WINDOW_MS = 5000;
  private readonly MAX_MESSAGES_PER_WINDOW = 6;
  private readonly LOCKOUT_MS = 5000;
  private readonly MAX_TRACKED_USERS = 10000;

  private readonly recentSends = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();

  /**
   * Throw 429 if user is currently rate-limited, otherwise records the send
   */
  assertNotRateLimited(userId: string): void {
    const now = Date.now();
    const lockExpiresAt = this.lockedUntil.get(userId);

    if (lockExpiresAt !== undefined) {
      if (now < lockExpiresAt) {
        touch(this.lockedUntil, userId, lockExpiresAt);
        this.reject(lockExpiresAt - now);
      }

      this.lockedUntil.delete(userId);
    }

    const recent = pruneOldTimestamps(
      this.recentSends.get(userId) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > this.MAX_MESSAGES_PER_WINDOW) {
      this.recentSends.delete(userId);
      evictOldestIfAtCapacity(this.lockedUntil, this.MAX_TRACKED_USERS, userId);
      touch(this.lockedUntil, userId, now + this.LOCKOUT_MS);
      this.reject(this.LOCKOUT_MS);
      return;
    }

    evictOldestIfAtCapacity(this.recentSends, this.MAX_TRACKED_USERS, userId);
    touch(this.recentSends, userId, recent);
  }

  private reject(remainingMs: number): never {
    throw new RateLimitedException(
      'You are sending messages too fast, please slow down',
      Math.ceil(remainingMs / 1000),
    );
  }
}
