import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  evictOldestIfAtCapacity,
  pruneOldTimestamps,
  touch,
} from '../common/utils/bounded-map';

/**
 * Rate limits how often one user can register a device or top up key
 * packages. Each call can carry up to 50 key packages
 * (@ArrayMaxSize(50)), and every one of them gets a real Ed25519/X25519
 * signature verification (decodeAndVerifyKeyPackage) - with no limit here,
 * an authenticated user could force unlimited real crypto work with zero
 * cooldown, unlike claimKeyPackageForUser which was already guarded by
 * KeyPackageFetchRateLimiterService.
 */
@Injectable()
export class KeyPackageUploadRateLimiterService {
  private readonly WINDOW_MS = 60_000;
  private readonly MAX_UPLOADS_PER_WINDOW = 5;
  private readonly MAX_TRACKED_USERS = 10000;

  private readonly recentUploads = new Map<string, number[]>();

  assertNotRateLimited(userId: string): void {
    const now = Date.now();
    const recent = pruneOldTimestamps(
      this.recentUploads.get(userId) ?? [],
      now,
      this.WINDOW_MS,
    );
    recent.push(now);

    if (recent.length > this.MAX_UPLOADS_PER_WINDOW) {
      throw new RateLimitedException(
        'You are uploading key packages too fast, please slow down',
        Math.ceil(this.WINDOW_MS / 1000),
      );
    }

    evictOldestIfAtCapacity(this.recentUploads, this.MAX_TRACKED_USERS, userId);
    touch(this.recentUploads, userId, recent);
  }
}
