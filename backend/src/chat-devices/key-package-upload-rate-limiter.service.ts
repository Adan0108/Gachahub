import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

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
  private readonly limiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 5,
    maxTrackedKeys: 10000,
    message: 'You are uploading key packages too fast, please slow down',
  });

  assertNotRateLimited(userId: string): void {
    this.limiter.assertNotRateLimited(userId);
  }
}
