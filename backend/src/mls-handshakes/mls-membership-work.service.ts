import { Injectable } from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { buildMembershipWork } from './membership-work';
import {
  MlsMembershipWorkRepository,
  type MembershipWorkScope,
} from './mls-membership-work.repository';

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

  async getMembershipWork(
    userId: string,
    deviceId: string,
    options: {
      scope?: MembershipWorkScope;
      after?: string;
      conversationId?: string;
    } = {},
  ) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);

    const conversations =
      await this.mlsMembershipWorkRepository.findConversationsNeedingWork({
        deviceId,
        userId,
        scope: options.scope ?? 'pending',
        after: options.after,
        conversationId: options.conversationId,
        limit: CONVERSATIONS_PER_PAGE,
      });

    const devices =
      conversations.length > 0
        ? await this.mlsMembershipWorkRepository.findDevices({
            userIds: unique(
              conversations.flatMap((conversation) =>
                conversation.participants.map(
                  (participant) => participant.userId,
                ),
              ),
            ),
            deviceIds: unique(
              conversations.flatMap((conversation) =>
                conversation.activeLeaves.map((leaf) => leaf.deviceId),
              ),
            ),
          })
        : [];

    return {
      items: buildMembershipWork({
        conversations,
        devices,
        requestingDeviceId: deviceId,
      }),
      // A full page means there may be more; a conversation with nothing the
      // device can act on is left out of `items` but still counts toward the page.
      nextCursor:
        conversations.length === CONVERSATIONS_PER_PAGE
          ? conversations[conversations.length - 1].id
          : null,
    };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
