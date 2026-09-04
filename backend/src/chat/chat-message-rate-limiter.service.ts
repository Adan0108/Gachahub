import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';

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
        this.touch(this.lockedUntil, userId, lockExpiresAt);
        this.reject(lockExpiresAt - now);
      }

      this.lockedUntil.delete(userId);
    }

    const windowStart = now - this.WINDOW_MS;
    const recent = (this.recentSends.get(userId) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );
    recent.push(now);

    if (recent.length > this.MAX_MESSAGES_PER_WINDOW) {
      this.recentSends.delete(userId);
      this.evictOldestIfAtCapacity(this.lockedUntil, userId);
      this.touch(this.lockedUntil, userId, now + this.LOCKOUT_MS);
      this.reject(this.LOCKOUT_MS);
      return;
    }

    this.evictOldestIfAtCapacity(this.recentSends, userId);
    this.touch(this.recentSends, userId, recent);
  }

  // moves key to the most-recently-used end so it survives eviction longer
  private touch<StoredValue>(
    map: Map<string, StoredValue>,
    key: string,
    value: StoredValue,
  ): void {
    map.delete(key);
    map.set(key, value);
  }

  // shared by both maps - keeps memory bounded since REST requests have
  // no connection lifecycle to hook cleanup into, unlike the typing gateway
  private evictOldestIfAtCapacity<StoredValue>(
    map: Map<string, StoredValue>,
    keyAboutToBeAdded?: string,
  ): void {
    if (
      (keyAboutToBeAdded === undefined || !map.has(keyAboutToBeAdded)) &&
      map.size >= this.MAX_TRACKED_USERS
    ) {
      const [oldestKey] = map.keys();
      map.delete(oldestKey);
    }
  }

  private reject(remainingMs: number): never {
    throw new RateLimitedException(
      'You are sending messages too fast, please slow down',
      Math.ceil(remainingMs / 1000),
    );
  }
}
