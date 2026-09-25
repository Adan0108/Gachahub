import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/utils/sliding-window-rate-limiter';

/** Per-user limits for the backup endpoints; uploads and restore pages are bulk by design, key changes are not. */
@Injectable()
export class ChatBackupRateLimiterService {
  private readonly upload = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 60,
    maxTrackedKeys: 10000,
    message: 'You are backing up messages too fast, please slow down',
  });
  private readonly download = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 120,
    maxTrackedKeys: 10000,
    message: 'You are restoring history too fast, please slow down',
  });
  private readonly manage = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxPerWindow: 10,
    maxTrackedKeys: 10000,
    message: 'You are changing backup settings too fast, please slow down',
  });

  private readonly destroy = new SlidingWindowRateLimiter({
    windowMs: 60 * 60_000,
    maxPerWindow: 3,
    maxTrackedKeys: 10000,
    message: 'You turned backup off too many times, please try again later',
  });

  assertCanUpload(userId: string): void {
    this.upload.assertNotRateLimited(userId);
  }

  assertCanDownload(userId: string): void {
    this.download.assertNotRateLimited(userId);
  }

  assertCanManage(userId: string): void {
    this.manage.assertNotRateLimited(userId);
  }

  assertCanDestroy(userId: string): void {
    this.destroy.assertNotRateLimited(userId);
  }
}
