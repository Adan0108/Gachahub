import { Injectable } from '@nestjs/common';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import {
  buildMembershipWork,
  type MembershipWorkItem,
} from './membership-work';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import {
  MlsMembershipWorkRepository,
  type MembershipWorkScope,
} from './mls-membership-work.repository';

/** Conversations examined per request; a client pages on with `nextCursor`. */
const CONVERSATIONS_PER_PAGE = 50;

/** Must outlast one client reconcile pass (polled every 5s, see useSyncEngine). */
const WORK_LEASE_MS = 60_000;

/** A device whose lease ended without a Commit stays out for this long; keep it above the poll interval. */
const WORK_COOLDOWN_MS = 2 * 60_000;

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
    private readonly requestRateLimiter: MlsRequestRateLimiterService,
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
    this.requestRateLimiter.assertMayTakeMembershipWork(userId);
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

    const refusingInviteeIds =
      await this.chatDevicesService.findInviteesRefusingRequester(
        userId,
        unique(
          conversations.flatMap((conversation) =>
            conversation.participants
              .filter(
                (participant) =>
                  participant.state === 'PENDING' &&
                  participant.userId !== userId,
              )
              .map((participant) => participant.userId),
          ),
        ),
      );

    const items = buildMembershipWork({
      conversations,
      devices,
      requestingDeviceId: deviceId,
      refusingInviteeIds,
    });

    return {
      items: await this.keepOnlyLeased(items, deviceId),
      // A full page means there may be more; a conversation with nothing the
      // device can act on is left out of `items` but still counts toward the page.
      nextCursor:
        conversations.length === CONVERSATIONS_PER_PAGE
          ? conversations[conversations.length - 1].id
          : null,
    };
  }

  /** The device could not finish this conversation's work: hand it to someone else. */
  async releaseMembershipWork(
    userId: string,
    deviceId: string,
    conversationId: string,
  ) {
    await this.chatDevicesService.assertOwnActiveDevice(userId, deviceId);
    await this.mlsMembershipWorkRepository.releaseLease({
      deviceId,
      conversationId,
      now: new Date(),
    });
  }

  /** Work is handed to one device at a time: drop what another member already holds. */
  private async keepOnlyLeased(items: MembershipWorkItem[], deviceId: string) {
    if (items.length === 0) return items;

    const now = new Date();
    const held = await this.mlsMembershipWorkRepository.leaseConversations({
      deviceId,
      conversationIds: items.map((item) => item.conversationId),
      now,
      until: new Date(now.getTime() + WORK_LEASE_MS),
      cooldownMs: WORK_COOLDOWN_MS,
    });

    return items.filter((item) => held.has(item.conversationId));
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
