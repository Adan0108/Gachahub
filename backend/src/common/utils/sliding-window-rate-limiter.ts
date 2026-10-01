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

/** In-memory sliding-window limiter with an optional lockout; the ordering below is load-bearing. */
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
    const retryAfterMs = this.attempt(key, cost);
    if (retryAfterMs !== null) {
      this.reject(retryAfterMs);
    }
  }

  /** Like assertNotRateLimited, but returns false instead of throwing when over the limit. */
  tryConsume(key: string, cost = 1): boolean {
    return this.attempt(key, cost) === null;
  }

  /** Records the attempt and returns null, or returns how long to wait without recording it. */
  private attempt(key: string, cost: number): number | null {
    const { windowMs, maxPerWindow, lockoutMs, maxTrackedKeys } = this.config;
    const now = Date.now();
    const lockExpiresAt = this.lockedUntil.get(key);

    if (lockExpiresAt !== undefined) {
      if (now < lockExpiresAt) {
        touch(this.lockedUntil, key, lockExpiresAt);
        return lockExpiresAt - now;
      }

      this.lockedUntil.delete(key);
    }

    const recent = pruneOldTimestamps(
      this.recent.get(key) ?? [],
      now,
      windowMs,
    );

    if (recent.length + cost > maxPerWindow) {
      if (lockoutMs === undefined) {
        // Wait until enough hits age out to fit the cost; a cost over the cap never fits.
        const mustAgeOut = recent.length + cost - maxPerWindow;
        return cost > maxPerWindow
          ? windowMs
          : recent[mustAgeOut - 1] + windowMs - now;
      }

      this.recent.delete(key);
      evictOldestIfAtCapacity(this.lockedUntil, maxTrackedKeys, key);
      touch(this.lockedUntil, key, now + lockoutMs);
      return lockoutMs;
    }

    for (let i = 0; i < cost; i += 1) {
      recent.push(now);
    }
    evictOldestIfAtCapacity(this.recent, maxTrackedKeys, key);
    touch(this.recent, key, recent);
    return null;
  }

  private reject(retryAfterMs: number): never {
    throw new RateLimitedException(
      this.config.message,
      Math.ceil(retryAfterMs / 1000),
    );
  }
}

/** The common shape: a plain per-minute cap per user id, no lockout. */
export function perMinutePerUserLimiter(
  maxPerMinute: number,
  message: string,
): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: maxPerMinute,
    maxTrackedKeys: 10000,
    message,
  });
}
