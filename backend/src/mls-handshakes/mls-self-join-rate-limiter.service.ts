import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Per-user limits on joining groups by yourself. Fetching a snapshot is cheap
 * but enumerable; a join advances a group's epoch, so it gets a tighter cap.
 */
@Injectable()
export class MlsSelfJoinRateLimiterService {
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_SNAPSHOT_FETCHES = 30;
  private readonly MAX_JOINS = 10;
  private readonly MAX_TRACKED_USERS = 10000;

  private readonly recentFetches = new Map<string, number[]>();
  private readonly recentJoins = new Map<string, number[]>();

  assertMayFetchGroupInfo(userId: string): void {
    this.assertUnderLimit(
      this.recentFetches,
      userId,
      this.MAX_SNAPSHOT_FETCHES,
      'You are fetching group snapshots too fast, please slow down',
    );
  }

  assertMayJoin(userId: string): void {
    this.assertUnderLimit(
      this.recentJoins,
      userId,
      this.MAX_JOINS,
      'You are joining groups too fast, please slow down',
    );
  }

  private assertUnderLimit(
    bucket: Map<string, number[]>,
    userId: string,
    maxPerWindow: number,
    message: string,
  ): void {
    const now = Date.now();
    const recent = pruneOldTimestamps(
      bucket.get(userId) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > maxPerWindow) {
      throw new RateLimitedException(message, Math.ceil(this.WINDOW_MS / 1000));
    }

    evictOldestIfAtCapacity(bucket, this.MAX_TRACKED_USERS, userId);
    touch(bucket, userId, recent);
  }
}
