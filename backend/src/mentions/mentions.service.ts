import { Injectable } from '@nestjs/common';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import type { MentionTargetType } from '../domain-events/domain-event.types';
import type { Prisma } from '../generated/prisma/client';
import { extractMentionHandles } from './mention-parser';

interface PublishMentionsInput {
  text: string;
  actorId: string;
  entityType: MentionTargetType;
  entityId: string;
  /** Mentioned users who fail this are skipped, so a mention never reveals content they can't open. */
  canView: (userId: string) => Promise<boolean>;
  /** For edits: a user already mentioned in the old text who could already view it is not pinged again. */
  previous?: { text: string; canView: (userId: string) => Promise<boolean> };
}

@Injectable()
export class MentionsService {
  constructor(private readonly eventPublisher: EventPublisherPort) {}

  /** One `user.mentioned` event per distinct, active, non-blocked, allowed-to-view mentioned user. */
  async publishMentions(
    input: PublishMentionsInput,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const { text, actorId, entityType, entityId, canView, previous } = input;
    const handles = extractMentionHandles(text);

    if (handles.length === 0) {
      return;
    }

    const users = await transaction.user.findMany({
      where: {
        username: { in: handles },
        id: { not: actorId },
        status: 'ACTIVE',
        blockedUsers: { none: { blockedId: actorId } },
        blockedBy: { none: { blockerId: actorId } },
      },
      select: { id: true, username: true },
    });

    const previousHandles = new Set(
      previous
        ? extractMentionHandles(previous.text).map((handle) =>
            handle.toLowerCase(),
          )
        : [],
    );

    const allowed = await Promise.all(
      users.map(async (user) => {
        if (!(await canView(user.id))) {
          return false;
        }

        const alreadyNotified =
          previous &&
          previousHandles.has(user.username?.toLowerCase() ?? '') &&
          (await previous.canView(user.id));

        return !alreadyNotified;
      }),
    );
    const targets = users.filter((_, index) => allowed[index]);

    await this.eventPublisher.publishMany(
      targets.map((user) => ({
        type: 'user.mentioned' as const,
        aggregateId: entityId,
        payload: { targetUserId: user.id, actorId, entityType, entityId },
      })),
      transaction,
    );
  }
}
