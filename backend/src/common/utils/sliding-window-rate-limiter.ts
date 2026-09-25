import { RateLimitedException } from '../exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from './bounded-map';

export interface SlidingWindowRateLimiterConfig {
  windowMs: number;
  maxPerWindow: number;
  /** Once the cap is crossed, reject everything for this long. Omit to just reject until the window slides. */
  lockoutMs?: number;
  maxTrackedKeys: number;
  message: string;
}

/**
 * In-memory sliding-window limiter, optionally with a lockout after the cap is
 * crossed. The ordering below is load-bearing, which is why it lives in one place:
 * touching the lockout on every read keeps it from being evicted early, and
 * dropping the window when a lockout starts keeps the fetches counted before it
 * from being counted again once it ends. A rejected attempt is never recorded.
 */
export class SlidingWindowRateLimiter {
  private readonly recent = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();

  constructor(private readonly config: SlidingWindowRateLimiterConfig) {}

  /** Number of keys currently tracked in the sliding-window map. */
  get trackedKeyCount(): number {
    return this.recent.size;
  }

  /** `cost` counts as that many attempts - a request that hands out N things counts N times. */
  assertNotRateLimited(key: string, cost = 1): void {
    const { windowMs, maxPerWindow, lockoutMs, maxTrackedKeys } = this.config;
    const now = Date.now();
    const lockExpiresAt = this.lockedUntil.get(key);

    if (lockExpiresAt !== undefined) {
      if (now < lockExpiresAt) {
        touch(this.lockedUntil, key, lockExpiresAt);
        this.reject(lockExpiresAt - now);
      }

      this.lockedUntil.delete(key);
    }

    const recent = pruneOldTimestamps(
      this.recent.get(key) ?? [],
      now,
      windowMs,
    );
    for (let i = 0; i < cost; i += 1) {
      recent.push(now);
    }

    if (recent.length > maxPerWindow) {
      if (lockoutMs === undefined) {
        this.reject(windowMs);
      }

      this.recent.delete(key);
      evictOldestIfAtCapacity(this.lockedUntil, maxTrackedKeys, key);
      touch(this.lockedUntil, key, now + lockoutMs);
      this.reject(lockoutMs);
    }

    evictOldestIfAtCapacity(this.recent, maxTrackedKeys, key);
    touch(this.recent, key, recent);
  }

  private reject(retryAfterMs: number): never {
    throw new RateLimitedException(
      this.config.message,
      Math.ceil(retryAfterMs / 1000),
    );
  }
}
