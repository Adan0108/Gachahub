import { Injectable } from '@nestjs/common';
import type { ChatParticipantState } from '../../generated/prisma/client';
import { EventPublisherPort } from '../../domain-events/event-publisher.port';
import type { ChatParticipantAddedState } from '../../domain-events/domain-event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatMembershipRepository } from './chat-membership.repository';
import type {
  MembershipRequest,
  OnIllegalMembershipChange,
} from './plan-membership-changes';

/** ADD_DIRECT/ADD_INVITE only ever resolve to one of these; anything else is a bug in the state machine. */
function toAddedParticipantState(
  to: ChatParticipantState,
): ChatParticipantAddedState {
  if (to === 'ACTIVE' || to === 'JOINING' || to === 'PENDING') return to;
  throw new Error(`ADD_DIRECT/ADD_INVITE resolved to unexpected state ${to}`);
}

/** One change per person: two requests against the same starting state would fail the second's conditional write. */
function dedupeByUser(
  requests: readonly MembershipRequest[],
): MembershipRequest[] {
  return [
    ...new Map(requests.map((request) => [request.userId, request])).values(),
  ];
}

/** How someone being added gets in: straight away, or only once they accept. */
export type GroupMemberEntitlement = 'DIRECT' | 'INVITE';

/** Turns add/remove/accept/decline into participant state changes; never touches MLS itself. */
@Injectable()
export class ChatMembershipService {
  constructor(
    private readonly chatMembershipRepository: ChatMembershipRepository,
    private readonly eventPublisher: EventPublisherPort,
    private readonly prisma: PrismaService,
  ) {}

  /** Adds members and publishes one chat.participant.added per transition actually applied (no-ops skipped), same transaction as the write. */
  async addMembers(
    conversationId: string,
    members: Array<{ userId: string; entitlement: GroupMemberEntitlement }>,
    actorId: string,
  ): Promise<{ count: number }> {
    const requests = dedupeByUser(
      members.map(({ userId, entitlement }) => ({
        userId,
        event:
          entitlement === 'DIRECT'
            ? ('ADD_DIRECT' as const)
            : ('ADD_INVITE' as const),
      })),
    );

    const count = await this.prisma.$transaction(async (tx) => {
      const changes =
        await this.chatMembershipRepository.changeMembershipInTransaction(
          tx,
          conversationId,
          requests,
        );

      if (changes.length > 0) {
        await this.eventPublisher.publishMany(
          changes.map((change) => ({
            type: 'chat.participant.added' as const,
            aggregateId: conversationId,
            payload: {
              conversationId,
              addedUserId: change.userId,
              actorId,
              state: toAddedParticipantState(change.to),
            },
          })),
          tx,
        );
      }

      return changes.length;
    });

    return { count };
  }

  /** Removes members, or lets someone leave. Owners are skipped: ownership must be transferred first. */
  async removeMembers(
    conversationId: string,
    userIds: string[],
  ): Promise<{ count: number }> {
    return this.change(
      conversationId,
      userIds.map((userId) => ({ userId, event: 'REMOVE' })),
    );
  }

  async acceptInvite(conversationId: string, userId: string): Promise<void> {
    await this.change(conversationId, [{ userId, event: 'ACCEPT_INVITE' }]);
  }

  async declineInvite(conversationId: string, userId: string): Promise<void> {
    await this.change(conversationId, [{ userId, event: 'DECLINE_INVITE' }]);
  }

  /** Expires invites nobody answered; anyone no longer PENDING is skipped, not offboarded. */
  async expireInvites(
    conversationId: string,
    userIds: string[],
  ): Promise<{ count: number }> {
    return this.change(
      conversationId,
      userIds.map((userId) => ({ userId, event: 'EXPIRE_INVITE' })),
      'skip',
    );
  }

  /** Shared path for every membership change that doesn't need to publish anything. */
  private async change(
    conversationId: string,
    requests: MembershipRequest[],
    onIllegal?: OnIllegalMembershipChange,
  ): Promise<{ count: number }> {
    const count = await this.chatMembershipRepository.changeMembership(
      conversationId,
      dedupeByUser(requests),
      onIllegal,
    );

    return { count };
  }
}
