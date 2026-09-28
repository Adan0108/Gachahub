import { Injectable } from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import { MlsMembershipWorkRepository } from './mls-membership-work.repository';
import { MlsSelfJoinRepository } from './mls-self-join.repository';

/** One cheap check of whether this device has anything to do. */
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
