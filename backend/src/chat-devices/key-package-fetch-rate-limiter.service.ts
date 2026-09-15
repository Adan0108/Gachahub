import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Rate limits how fast one user can fetch OTHER users' key packages.
 *
 * Anti-draining (critique C1): without this, anyone could enumerate a
 * user's devices or exhaust their single-use key packages by fetching one
 * on repeat - the same-shape risk chatMessageRateLimiter guards against for
 * message spam.
 */
@Injectable()
export class KeyPackageFetchRateLimiterService {
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_FETCHES_PER_WINDOW = 20;
  private readonly MAX_TRACKED_USERS = 10000;

  private readonly recentFetches = new Map<string, number[]>();

  assertNotRateLimited(userId: string): void {
    const now = Date.now();
    const recent = pruneOldTimestamps(
      this.recentFetches.get(userId) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > this.MAX_FETCHES_PER_WINDOW) {
      throw new RateLimitedException(
        'You are fetching key packages too fast, please slow down',
        Math.ceil(this.WINDOW_MS / 1000),
      );
    }

    evictOldestIfAtCapacity(this.recentFetches, this.MAX_TRACKED_USERS, userId);
    touch(this.recentFetches, userId, recent);
  }
}
