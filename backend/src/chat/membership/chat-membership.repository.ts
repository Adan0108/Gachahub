import { Injectable } from '@nestjs/common';
import { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { applyParticipantTransitions } from './apply-participant-transitions';
import { lockConversation } from './lock-conversation';
import {
  planMembershipChanges,
  type MembershipRequest,
  type OnIllegalMembershipChange,
} from './plan-membership-changes';

/**
 * Applies membership events (add, remove, accept, decline) to a conversation's
 * participants. Everything happens in one transaction under the conversation's
 * row lock, so what is read about the MLS group - whether it exists, who has a
 * device in it - cannot change before the participants are written. A Commit
 * accepted in between would otherwise leave someone ACTIVE without a device, or
 * decline someone whose devices it just added.
 */
@Injectable()
export class ChatMembershipRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  /** Returns how many participants changed. */
  changeMembership(
    conversationId: string,
    requests: readonly MembershipRequest[],
    onIllegal: OnIllegalMembershipChange = 'throw',
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await lockConversation(tx, conversationId);

      const mlsActive = await this.mlsGroupRosterRepository.hasRoster(
        conversationId,
        tx,
      );
      const leaves = mlsActive
        ? await this.mlsGroupRosterRepository.findActiveLeaves(
            conversationId,
            tx,
          )
        : [];
      const participants = await tx.chatParticipant.findMany({
        where: {
          conversationId,
          userId: { in: requests.map((request) => request.userId) },
        },
        select: { userId: true, state: true, role: true },
      });

      const changes = planMembershipChanges({
        requests,
        participants,
        mlsActive,
        userIdsWithLeaves: new Set(leaves.map((leaf) => leaf.userId)),
        onIllegal,
      });

      return applyParticipantTransitions(tx, conversationId, changes);
    });
  }

  /**
   * PENDING participants (group invite or DM message request) whose invite has sat
   * unanswered since before `cutoff`, grouped by conversation. PENDING is entitled to
   * an MLS leaf (see leaf-entitlement.ts), so an invite nobody ever accepts or
   * declines would otherwise be permanent cryptographic membership - see
   * ChatInviteExpiryService, which turns this into an EXPIRE_INVITE per conversation.
   *
   * updatedAt, not createdAt: a participant re-invited after DECLINED updates the
   * same row rather than creating a new one, and Prisma's @updatedAt already tracks
   * exactly "when they most recently entered PENDING" for that case.
   */
  async findExpiredPendingInvites(
    cutoff: Date,
  ): Promise<Map<string, string[]>> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: { state: 'PENDING', updatedAt: { lt: cutoff } },
      select: { conversationId: true, userId: true },
    });

    const userIdsByConversationId = new Map<string, string[]>();
    for (const row of rows) {
      const userIds = userIdsByConversationId.get(row.conversationId) ?? [];
      userIds.push(row.userId);
      userIdsByConversationId.set(row.conversationId, userIds);
    }

    return userIdsByConversationId;
  }
}
