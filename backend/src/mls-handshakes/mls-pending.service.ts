import { Injectable } from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import { MlsMembershipWorkRepository } from './mls-membership-work.repository';
import { MlsSelfJoinRepository } from './mls-self-join.repository';

/**
 * One cheap answer to "does this device have anything to do?", so the regular
 * poll is a single request instead of three - the heavy calls (welcomes, joins,
 * membership work) run only when this says there is something.
 */
@Injectable()
export class MlsPendingService {
  constructor(
    private readonly handshakesRepository: MlsHandshakesRepository,
    private readonly selfJoinRepository: MlsSelfJoinRepository,
    private readonly workRepository: MlsMembershipWorkRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly requestRateLimiter: MlsRequestRateLimiterService,
  ) {}

  async getPendingSummary(userId: string, deviceId: string) {
    this.requestRateLimiter.assertMayPollPending(userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const [welcomes, joinable, membershipWork] = await Promise.all([
      this.handshakesRepository.countPendingWelcomes(deviceId),
      this.selfJoinRepository.findJoinableConversationIds({
        userId,
        deviceId,
        scope: 'pending',
        limit: 1,
      }),
      this.workRepository.hasPendingWork(deviceId, userId),
    ]);

    return { welcomes, joinable: joinable.length > 0, membershipWork };
  }
}
