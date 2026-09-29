import { Injectable } from '@nestjs/common';
import { perMinutePerUserLimiter } from '../common/utils/sliding-window-rate-limiter';

/** Per-user limits on joining groups by yourself; joins get a tighter cap. */
@Injectable()
export class MlsSelfJoinRateLimiterService {
  private readonly fetchLimiter = perMinutePerUserLimiter(
    30,
    'You are fetching group snapshots too fast, please slow down',
  );

  private readonly joinLimiter = perMinutePerUserLimiter(
    10,
    'You are joining groups too fast, please slow down',
  );

  assertMayFetchGroupInfo(userId: string): void {
    this.fetchLimiter.assertNotRateLimited(userId);
  }

  assertMayJoin(userId: string): void {
    this.joinLimiter.assertNotRateLimited(userId);
  }
}
