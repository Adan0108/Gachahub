import { Injectable } from '@nestjs/common';
import {
  perMinutePerUserLimiter,
  SlidingWindowRateLimiter,
} from '../common/utils/sliding-window-rate-limiter';

/** Snapshot-deleting reports one conversation may cause per hour. */
const SNAPSHOT_DELETIONS_PER_HOUR = 3;

/** Per-user cap on commit-fault reports, plus a per-conversation budget for the ones allowed to delete the GroupInfo. */
@Injectable()
export class MlsFaultReportRateLimiterService {
  private readonly limiter = perMinutePerUserLimiter(
    60,
    'You are reporting commit faults too fast, please slow down',
  );

  private readonly snapshotDeletionLimiter = new SlidingWindowRateLimiter({
    windowMs: 60 * 60_000,
    maxPerWindow: SNAPSHOT_DELETIONS_PER_HOUR,
    maxTrackedKeys: 10000,
    message: 'Too many snapshot deletions for this conversation',
  });

  assertMayReport(userId: string): void {
    this.limiter.assertNotRateLimited(userId);
  }

  /** Spends one of the conversation's hourly snapshot deletions; false once they are used up. */
  tryConsumeSnapshotDeletion(conversationId: string): boolean {
    return this.snapshotDeletionLimiter.tryConsume(conversationId);
  }
}
