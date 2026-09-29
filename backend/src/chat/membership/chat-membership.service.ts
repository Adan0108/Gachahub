import { Injectable } from '@nestjs/common';
import { ChatMembershipRepository } from './chat-membership.repository';
import type {
  MembershipRequest,
  OnIllegalMembershipChange,
} from './plan-membership-changes';

/** How someone being added gets in: straight away, or only once they accept. */
export type GroupMemberEntitlement = 'DIRECT' | 'INVITE';

/** Turns add/remove/accept/decline into participant state changes; never touches MLS itself. */
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

  private async change(
    conversationId: string,
    requests: MembershipRequest[],
    onIllegal?: OnIllegalMembershipChange,
  ): Promise<{ count: number }> {
    // One change per person: two against the same starting state would fail the second's conditional write.
    const onePerUser = [
      ...new Map(requests.map((request) => [request.userId, request])).values(),
    ];

    const count = await this.chatMembershipRepository.changeMembership(
      conversationId,
      onePerUser,
      onIllegal,
    );

    return { count };
  }
}
