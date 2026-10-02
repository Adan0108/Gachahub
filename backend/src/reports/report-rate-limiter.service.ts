import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Rate limits how fast one user can file reports. In-memory, single-instance -
 * same tradeoff as ChatMessageRateLimiterService, since neither is wired to
 * Redis yet (see BACKLOG.md's "Redis cross-instance fanout").
 */
@Injectable()
export class ReportRateLimiterService {
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_REPORTS_PER_WINDOW = 5;
  private readonly LOCKOUT_MS = 60_000;
  private readonly MAX_TRACKED_USERS = 10_000;

  private readonly recentReports = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();

  /**
   * Throw 429 if the user is currently rate-limited, otherwise records the report.
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
      this.recentReports.get(userId) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > this.MAX_REPORTS_PER_WINDOW) {
      this.recentReports.delete(userId);
      evictOldestIfAtCapacity(this.lockedUntil, this.MAX_TRACKED_USERS, userId);
      touch(this.lockedUntil, userId, now + this.LOCKOUT_MS);
      this.reject(this.LOCKOUT_MS);
      return;
    }

    evictOldestIfAtCapacity(this.recentReports, this.MAX_TRACKED_USERS, userId);
    touch(this.recentReports, userId, recent);
  }

  private reject(remainingMs: number): never {
    throw new RateLimitedException(
      'You are filing reports too fast, please slow down',
      Math.ceil(remainingMs / 1000),
    );
  }
}
