import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  applyParticipantTransitions,
  type ParticipantTransition,
} from './apply-participant-transitions';
import { lockConversation } from './lock-conversation';
import {
  planMembershipChanges,
  type MembershipRequest,
  type OnIllegalMembershipChange,
} from './plan-membership-changes';

/** Applies membership events to a conversation's participants in one transaction under the conversation row lock. */
@Injectable()
export class ChatMembershipRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  /** Applies membership changes and returns the transitions actually applied (no-ops excluded), against the caller's own transaction. */
  async changeMembershipInTransaction(
    tx: Prisma.TransactionClient,
    conversationId: string,
    requests: readonly MembershipRequest[],
    onIllegal: OnIllegalMembershipChange = 'throw',
  ): Promise<ParticipantTransition[]> {
    await lockConversation(tx, conversationId);

    const mlsActive = await this.mlsGroupRosterRepository.hasRoster(
      conversationId,
      tx,
    );
    const leaves = mlsActive
      ? await this.mlsGroupRosterRepository.findActiveLeaves(conversationId, tx)
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

    await applyParticipantTransitions(tx, conversationId, changes);

    return changes;
  }

  /** Returns how many participants changed. Opens its own transaction - use changeMembershipInTransaction directly when the caller needs to publish a domain event alongside this write. */
  changeMembership(
    conversationId: string,
    requests: readonly MembershipRequest[],
    onIllegal: OnIllegalMembershipChange = 'throw',
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const changes = await this.changeMembershipInTransaction(
        tx,
        conversationId,
        requests,
        onIllegal,
      );

      return changes.length;
    });
  }

  /** Stamps PENDING rows written without pendingSince (e.g. by older code mid-deploy) so they start their expiry clock. */
  async stampMissingPendingSince(now: Date): Promise<number> {
    const { count } = await this.prisma.chatParticipant.updateMany({
      where: { state: 'PENDING', pendingSince: null },
      data: { pendingSince: now },
    });

    return count;
  }

  /** PENDING participants whose invite predates `cutoff`, grouped by conversation, oldest first, capped at `limit`. */
  async findExpiredPendingInvites(
    cutoff: Date,
    limit: number,
  ): Promise<Map<string, string[]>> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: { state: 'PENDING', pendingSince: { lt: cutoff } },
      select: { conversationId: true, userId: true },
      orderBy: [{ pendingSince: 'asc' }, { id: 'asc' }],
      take: limit,
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
