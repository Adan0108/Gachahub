import { Injectable } from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { buildMembershipWork } from './membership-work';
import { MlsMembershipWorkRepository } from './mls-membership-work.repository';

/** Conversations examined per request; a client pages on with `nextCursor`. */
const CONVERSATIONS_PER_PAGE = 50;

/**
 * Tells a device which membership changes it can finish. The server can't
 * create the Commits that add or remove devices - only a member's client can -
 * so it works out what is waiting and hands it to whichever member is online.
 * The device stages one Commit per conversation from the result and submits it.
 */
@Injectable()
export class MlsMembershipWorkService {
  constructor(
    private readonly mlsMembershipWorkRepository: MlsMembershipWorkRepository,
    private readonly chatDevicesService: ChatDevicesService,
  ) {}

  async getMembershipWork(userId: string, deviceId: string, after?: string) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const conversations =
      await this.mlsMembershipWorkRepository.findConversationsNeedingWork({
        deviceId,
        userId,
        after,
        limit: CONVERSATIONS_PER_PAGE,
      });

    const joiningUserIds = [
      ...new Set(
        conversations.flatMap((conversation) =>
          conversation.participants
            .filter((participant) => participant.state === 'JOINING')
            .map((participant) => participant.userId),
        ),
      ),
    ];

    const devicesOfJoiningUsers =
      joiningUserIds.length > 0
        ? await this.mlsMembershipWorkRepository.findUnrevokedDevicesOfUsers(
            joiningUserIds,
          )
        : [];

    return {
      items: buildMembershipWork({ conversations, devicesOfJoiningUsers }),
      // A full page means there may be more; a conversation with nothing the
      // device can act on is left out of `items` but still counts toward the page.
      nextCursor:
        conversations.length === CONVERSATIONS_PER_PAGE
          ? conversations[conversations.length - 1].id
          : null,
    };
  }
}
