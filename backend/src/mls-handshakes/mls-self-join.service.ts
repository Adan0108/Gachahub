import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isEntitledToLeaf } from '../chat/membership/leaf-entitlement';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import { MlsSelfJoinRateLimiterService } from './mls-self-join-rate-limiter.service';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import { ParticipantStateRepository } from '../mls-group-roster/participant-state.repository';
import {
  MlsSelfJoinRepository,
  type SelfJoinScope,
} from './mls-self-join.repository';

/** Conversations returned per request; a device that has more just asks again once these are done. */
const JOINABLE_PER_REQUEST = 50;

/** The reading side of a device joining by itself: joinable groups and the snapshot to join from. */
@Injectable()
export class MlsSelfJoinService {
  constructor(
    private readonly selfJoinRepository: MlsSelfJoinRepository,
    private readonly groupInfoRepository: MlsGroupInfoRepository,
    private readonly participantStates: ParticipantStateRepository,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly rateLimiter: MlsSelfJoinRateLimiterService,
    private readonly requestRateLimiter: MlsRequestRateLimiterService,
  ) {}

  async listJoinable(userId: string, deviceId: string, scope: SelfJoinScope) {
    this.requestRateLimiter.assertMayPollPending(userId);
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

  /** Only someone entitled to a leaf gets the snapshot; a device that is already a leaf takes it to replace that leaf after losing its state. */
  async getGroupInfo(userId: string, conversationId: string, deviceId: string) {
    this.rateLimiter.assertMayFetchGroupInfo(userId);
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const state = await this.participantStates.findState(
      conversationId,
      userId,
    );
    if (!isEntitledToLeaf(state)) {
      throw new ForbiddenException('Not entitled to join this conversation');
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
