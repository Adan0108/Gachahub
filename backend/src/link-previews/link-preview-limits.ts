import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { perMinutePerUserLimiter } from '../common/utils/sliding-window-rate-limiter';

/** Caps how fast one person can ask for previews, since each new link makes the server fetch a stranger's site. */
@Injectable()
export class LinkPreviewRateLimiterService {
  private readonly limiter = perMinutePerUserLimiter(
    12,
    'You are asking for link previews too fast, please slow down',
  );

  assertNotRateLimited(userId: string): void {
    this.limiter.assertNotRateLimited(userId);
  }
}

/** Caps how many pages are being fetched at once across everyone; the rest are told to try again in a moment. */
export class ConcurrencyGate {
  private running = 0;

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      throw new RateLimitedException(
        'Too many previews are loading, try again in a moment',
        2,
      );
    }

    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
    }
  }
}
