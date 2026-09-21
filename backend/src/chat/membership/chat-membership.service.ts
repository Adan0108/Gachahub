import { Injectable } from '@nestjs/common';
import { ChatMembershipRepository } from './chat-membership.repository';
import type { MembershipRequest } from './plan-membership-changes';

/** How someone being added gets in: straight away, or only once they accept. */
export type GroupMemberEntitlement = 'DIRECT' | 'INVITE';

/**
 * The authorization side of group membership: turns "add / remove / accept /
 * decline" into participant state changes. What each one means for a given
 * conversation - immediate when there is no MLS group, or via JOINING /
 * LEAVING when there is one - is decided by the membership state machine (see
 * planMembershipChanges) and applied atomically by ChatMembershipRepository.
 *
 * It never touches MLS itself. Finishing the cryptographic half - a Commit
 * that adds or removes the devices - is what moves someone out of JOINING or
 * LEAVING, in MlsHandshakesRepository.acceptHandshake.
 */
@Injectable()
export class ChatMembershipService {
  constructor(
    private readonly chatMembershipRepository: ChatMembershipRepository,
  ) {}

  async addMembers(
    conversationId: string,
    members: Array<{ userId: string; entitlement: GroupMemberEntitlement }>,
  ): Promise<{ count: number }> {
    return this.change(
      conversationId,
      members.map(({ userId, entitlement }) => ({
        userId,
        event: entitlement === 'DIRECT' ? 'ADD_DIRECT' : 'ADD_INVITE',
      })),
    );
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

  private async change(
    conversationId: string,
    requests: MembershipRequest[],
  ): Promise<{ count: number }> {
    // One change per person: two against the same starting state would make
    // the second one's conditional write fail.
    const onePerUser = [
      ...new Map(requests.map((request) => [request.userId, request])).values(),
    ];

    const count = await this.chatMembershipRepository.changeMembership(
      conversationId,
      onePerUser,
    );

    return { count };
  }
}
