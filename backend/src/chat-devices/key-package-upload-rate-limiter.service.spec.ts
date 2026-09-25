import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { KeyPackageUploadRateLimiterService } from './key-package-upload-rate-limiter.service';

describe('KeyPackageUploadRateLimiterService', () => {
  let limiter: KeyPackageUploadRateLimiterService;

  beforeEach(() => {
    limiter = new KeyPackageUploadRateLimiterService();
  });

  it('allows five uploads a minute per user, then refuses', () => {
    for (let i = 0; i < 5; i += 1) {
      limiter.assertNotRateLimited('user-1');
    }

    expect(() => limiter.assertNotRateLimited('user-1')).toThrow(
      RateLimitedException,
    );
  });

  it('counts each user separately', () => {
    for (let i = 0; i < 5; i += 1) {
      limiter.assertNotRateLimited('user-1');
    }

    expect(() => limiter.assertNotRateLimited('user-2')).not.toThrow();
  });
});
