import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

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
  private readonly byRequester = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 20,
    maxTrackedKeys: 10000,
    message: 'You are fetching key packages too fast, please slow down',
  });

  private readonly byTarget = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 60,
    maxTrackedKeys: 10000,
    message:
      'This user is receiving too many key package requests right now, please try again shortly',
  });

  /**
   * `cost` is how many key packages the request will hand out: a request that
   * claims across all of someone's devices drains their pool that many times
   * faster than a one-package request, so it counts that many times.
   */
  assertNotRateLimited(
    requesterId: string,
    targetUserId: string,
    cost = 1,
  ): void {
    this.byRequester.assertNotRateLimited(requesterId, cost);
    this.byTarget.assertNotRateLimited(targetUserId, cost);
  }
}
