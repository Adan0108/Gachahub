import { BadRequestException, Injectable } from '@nestjs/common';
import type { ChatParticipantState } from '../../generated/prisma/client';
import { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import { ChatRepository } from '../chat.repository';
import {
  resolveMembershipTransition,
  type MembershipEvent,
} from './membership-state-machine';

/** How someone being added gets in: straight away, or only once they accept. */
export type GroupMemberEntitlement = 'DIRECT' | 'INVITE';

interface MembershipRequest {
  userId: string;
  event: MembershipEvent;
}

/**
 * The authorization side of group membership: turns "add / remove / accept /
 * decline" into participant state changes, using the state machine to decide
 * what each one means for this conversation (immediate when there is no MLS
 * group, or via JOINING / LEAVING when there is one).
 *
 * It never touches MLS itself. Finishing the cryptographic half - a Commit
 * that adds or removes the devices - is what moves someone out of JOINING or
 * LEAVING, in MlsHandshakesRepository.acceptHandshake.
 *
 * Whether the conversation has an MLS group is read just before the changes
 * are applied, not inside the same transaction. The one way that can go stale
 * is the group's first Commit landing in between, which leaves an ACTIVE
 * member without a device in the group; the Commit that activates a group
 * reconciles its initial roster for exactly that case.
 */
@Injectable()
export class ChatMembershipService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  async addMembers(
    conversationId: string,
    members: Array<{ userId: string; entitlement: GroupMemberEntitlement }>,
  ): Promise<{ count: number }> {
    const count = await this.apply(
      conversationId,
      members.map(({ userId, entitlement }) => ({
        userId,
        event: entitlement === 'DIRECT' ? 'ADD_DIRECT' : 'ADD_INVITE',
      })),
    );

    return { count };
  }

  /** Removes members, or lets someone leave. Owners are skipped: ownership must be transferred first. */
  async removeMembers(
    conversationId: string,
    userIds: string[],
  ): Promise<{ count: number }> {
    const count = await this.apply(
      conversationId,
      userIds.map((userId) => ({ userId, event: 'REMOVE' })),
    );

    return { count };
  }

  async acceptInvite(conversationId: string, userId: string): Promise<void> {
    await this.apply(conversationId, [{ userId, event: 'ACCEPT_INVITE' }]);
  }

  async declineInvite(conversationId: string, userId: string): Promise<void> {
    await this.apply(conversationId, [{ userId, event: 'DECLINE_INVITE' }]);
  }

  private async apply(
    conversationId: string,
    requests: MembershipRequest[],
  ): Promise<number> {
    // One change per person: two against the same starting state would make
    // the second one's conditional write fail.
    const requestByUserId = new Map(
      requests.map((request) => [request.userId, request]),
    );

    const [mlsActive, participants] = await Promise.all([
      this.mlsGroupRosterRepository.hasRoster(conversationId),
      this.chatRepository.findParticipantsByUserIds(conversationId, [
        ...requestByUserId.keys(),
      ]),
    ]);
    const participantByUserId = new Map(
      participants.map((participant) => [participant.userId, participant]),
    );

    const changes: Array<{
      userId: string;
      from: ChatParticipantState | null;
      to: ChatParticipantState;
    }> = [];

    for (const { userId, event } of requestByUserId.values()) {
      const participant = participantByUserId.get(userId);

      if (participant?.role === 'OWNER' && event === 'REMOVE') {
        continue;
      }

      const transition = resolveMembershipTransition({
        from: participant?.state ?? 'NONE',
        event,
        mlsActive,
      });

      if (transition.kind === 'illegal') {
        throw new BadRequestException(
          event === 'ACCEPT_INVITE' || event === 'DECLINE_INVITE'
            ? 'Conversation is not pending'
            : `Cannot apply ${event} to a member in state ${participant?.state ?? 'NONE'}`,
        );
      }

      if (transition.kind === 'change') {
        changes.push({
          userId,
          from: participant?.state ?? null,
          to: transition.to,
        });
      }
    }

    return this.chatRepository.applyStateTransitions(conversationId, changes);
  }
}
