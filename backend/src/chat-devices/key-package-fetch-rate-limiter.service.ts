import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Rate limits how fast key packages get fetched, from both directions.
 *
 * Anti-draining (critique C1): without a per-requester limit, one caller
 * could enumerate a user's devices or exhaust their single-use key packages
 * by fetching on repeat. But a per-requester limit ALONE doesn't stop many
 * distinct requester accounts (each individually compliant) from
 * collectively draining one popular/targeted victim's pool - so this also
 * tracks fetches per target, with a higher ceiling since many legitimate
 * people can reasonably want to message the same popular account.
 */
@Injectable()
export class KeyPackageFetchRateLimiterService {
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_FETCHES_PER_REQUESTER = 20;
  private readonly MAX_FETCHES_PER_TARGET = 60;
  private readonly MAX_TRACKED_USERS = 10000;

  private readonly recentFetchesByRequester = new Map<string, number[]>();
  private readonly recentFetchesByTarget = new Map<string, number[]>();

  assertNotRateLimited(requesterId: string, targetUserId: string): void {
    this.assertBucketNotRateLimited(
      this.recentFetchesByRequester,
      requesterId,
      this.MAX_FETCHES_PER_REQUESTER,
      'You are fetching key packages too fast, please slow down',
    );
    this.assertBucketNotRateLimited(
      this.recentFetchesByTarget,
      targetUserId,
      this.MAX_FETCHES_PER_TARGET,
      'This user is receiving too many key package requests right now, please try again shortly',
    );
  }

  private assertBucketNotRateLimited(
    bucket: Map<string, number[]>,
    key: string,
    maxPerWindow: number,
    message: string,
  ): void {
    const now = Date.now();
    const recent = pruneOldTimestamps(
      bucket.get(key) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > maxPerWindow) {
      throw new RateLimitedException(message, Math.ceil(this.WINDOW_MS / 1000));
    }

    evictOldestIfAtCapacity(bucket, this.MAX_TRACKED_USERS, key);
    touch(bucket, key, recent);
  }
}
