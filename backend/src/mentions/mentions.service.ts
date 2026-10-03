import { Injectable } from '@nestjs/common';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import type { MentionTargetType } from '../domain-events/domain-event.types';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractMentionHandles } from './mention-parser';

interface ResolveTargetsInput {
  text: string;
  actorId: string;
  /** Mentioned users who fail this are skipped, so a mention never reveals content they can't open. */
  canView: (userId: string) => Promise<boolean>;
}

interface PublishMentionsInput {
  targetIds: string[];
  actorId: string;
  entityType: MentionTargetType;
  entityId: string;
}

@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  /**
   * Who a text may ping: active, non-blocked, allowed to view. Call this BEFORE opening the
   * transaction - canView reaches the follow graph on its own connection, and awaiting that
   * from inside a transaction holds the transaction's connection open meanwhile.
   */
  async resolveTargets(input: ResolveTargetsInput): Promise<string[]> {
    const { text, actorId, canView } = input;
    const handles = extractMentionHandles(text);

    if (handles.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        username: { in: handles },
        id: { not: actorId },
        status: 'ACTIVE',
        blockedUsers: { none: { blockedId: actorId } },
        blockedBy: { none: { blockerId: actorId } },
      },
      select: { id: true },
    });

    const allowed = await Promise.all(users.map((user) => canView(user.id)));

    return users.filter((_, index) => allowed[index]).map((user) => user.id);
  }

  /**
   * Outbox write only. The `mentions` row is the durable "already pinged" fact: skipDuplicates
   * returns just the rows it actually inserted, so editing a mention out and back in, or
   * re-saving a post, never notifies the same user twice for the same post/comment.
   */
  async publishMentions(
    input: PublishMentionsInput,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const { targetIds, actorId, entityType, entityId } = input;

    if (targetIds.length === 0) {
      return;
    }

    const fresh = await transaction.mention.createManyAndReturn({
      data: targetIds.map((userId) => ({ entityType, entityId, userId })),
      skipDuplicates: true,
      select: { userId: true },
    });

    await this.eventPublisher.publishMany(
      fresh.map(({ userId }) => ({
        type: 'user.mentioned' as const,
        aggregateId: entityId,
        payload: { targetUserId: userId, actorId, entityType, entityId },
      })),
      transaction,
    );
  }
}
