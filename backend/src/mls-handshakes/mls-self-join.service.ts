import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { MlsSelfJoinRateLimiterService } from './mls-self-join-rate-limiter.service';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import {
  MlsSelfJoinRepository,
  type SelfJoinScope,
} from './mls-self-join.repository';

/** Conversations returned per request; a device that has more just asks again once these are done. */
const JOINABLE_PER_REQUEST = 50;

/**
 * The reading side of a device joining a group by itself: which groups it could
 * join, and the public snapshot to join from. The joining itself is submitted
 * through MlsHandshakesService.submitExternalJoin, like any other Commit.
 */
@Injectable()
export class MlsSelfJoinService {
  constructor(
    private readonly selfJoinRepository: MlsSelfJoinRepository,
    private readonly groupInfoRepository: MlsGroupInfoRepository,
    private readonly handshakesRepository: MlsHandshakesRepository,
    private readonly rosterRepository: MlsGroupRosterRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly rateLimiter: MlsSelfJoinRateLimiterService,
  ) {}

  async listJoinable(userId: string, deviceId: string, scope: SelfJoinScope) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    return {
      conversationIds:
        await this.selfJoinRepository.findJoinableConversationIds({
          userId,
          deviceId,
          scope,
          limit: JOINABLE_PER_REQUEST,
        }),
    };
  }

  /** Only someone entitled to a leaf gets the snapshot, and only for a device that is not in the group yet. */
  async getGroupInfo(userId: string, conversationId: string, deviceId: string) {
    this.rateLimiter.assertMayFetchGroupInfo(userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const entitled = await this.handshakesRepository.isEntitledParticipant(
      conversationId,
      userId,
    );
    if (!entitled) {
      throw new ForbiddenException('Not entitled to join this conversation');
    }

    const leaves = await this.rosterRepository.findActiveLeaves(conversationId);
    if (leaves.some((leaf) => leaf.deviceId === deviceId)) {
      throw new ConflictException('This device is already in the group');
    }

    const info = await this.groupInfoRepository.findCurrent(conversationId);
    if (!info) {
      throw new NotFoundException(
        'No up-to-date snapshot of this group is available yet',
      );
    }

    return {
      epoch: info.epoch,
      groupInfo: Buffer.from(info.payload).toString('base64'),
    };
  }
}
