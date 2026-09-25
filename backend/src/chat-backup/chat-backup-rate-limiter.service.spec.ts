import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { ChatBackupRateLimiterService } from './chat-backup-rate-limiter.service';

describe('ChatBackupRateLimiterService', () => {
  it('limits key changes to 10 a minute per user', () => {
    const limiter = new ChatBackupRateLimiterService();

    for (let i = 0; i < 10; i += 1) {
      limiter.assertCanManage('u1');
    }

    expect(() => limiter.assertCanManage('u1')).toThrow(RateLimitedException);
    expect(() => limiter.assertCanManage('u2')).not.toThrow();
  });

  it('limits uploads to 60 a minute and downloads to 120', () => {
    const limiter = new ChatBackupRateLimiterService();

    for (let i = 0; i < 60; i += 1) {
      limiter.assertCanUpload('u1');
    }
    for (let i = 0; i < 120; i += 1) {
      limiter.assertCanDownload('u1');
    }

    expect(() => limiter.assertCanUpload('u1')).toThrow(RateLimitedException);
    expect(() => limiter.assertCanDownload('u1')).toThrow(RateLimitedException);
  });

  it('limits turning backup off to 3 an hour per user', () => {
    const limiter = new ChatBackupRateLimiterService();

    for (let i = 0; i < 3; i += 1) {
      limiter.assertCanDestroy('u1');
    }

    expect(() => limiter.assertCanDestroy('u1')).toThrow(RateLimitedException);
    expect(() => limiter.assertCanDestroy('u2')).not.toThrow();
  });
});
