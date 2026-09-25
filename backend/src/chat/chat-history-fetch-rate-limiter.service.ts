import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

/**
 * Rate limits scrolling back through one conversation's history.
 *
 * Applies only to paginated fetches (a beforeMessageId cursor), not the
 * initial page - a few batches load quickly, then hit a ceiling and wait.
 *
 * This is deliberate pacing on bulk history reads, requested as a product
 * decision independent of any security property - it is not standing in
 * for an authorization check, and it does not exist because a group
 * invitee can read further back than intended: MLS forward secrecy means a
 * newly-added device only ever gets the epoch it joined at, so there is no
 * backlog for faster paging to expose (see mls-threat-model.md §3). Keyed
 * per conversation, not per user, so browsing a big backlog in one busy
 * conversation doesn't spend the budget a completely different conversation
 * would otherwise have.
 */
@Injectable()
export class ChatHistoryFetchRateLimiterService {
  private readonly limiter = new SlidingWindowRateLimiter({
    windowMs: 10_000,
    maxPerWindow: 3,
    lockoutMs: 8_000,
    maxTrackedKeys: 10000,
    message: 'You are loading history too fast, please slow down',
  });

  /**
   * Throw 429 if this user is currently rate-limited on this conversation,
   * otherwise records the fetch.
   */
  assertNotRateLimited(userId: string, conversationId: string): void {
    this.limiter.assertNotRateLimited(`${userId}:${conversationId}`);
  }
}
