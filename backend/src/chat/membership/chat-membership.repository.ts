import { Injectable } from '@nestjs/common';
import { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { applyParticipantTransitions } from './apply-participant-transitions';
import { lockConversation } from './lock-conversation';
import {
  planMembershipChanges,
  type MembershipRequest,
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
      });

      return applyParticipantTransitions(tx, conversationId, changes);
    });
  }
}
