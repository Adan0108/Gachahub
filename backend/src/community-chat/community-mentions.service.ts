import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  extractMentionHandles,
  MAX_MENTIONS_PER_TEXT,
} from '../mentions/mention-parser';
import { MentionsService } from '../mentions/mentions.service';
import { CommunityAccessService } from './community-access.service';
import { COMMUNITY_MEMBER_SEARCH_LIMIT } from './community-chat.constants';
import { CommunityChatRepository } from './community-chat.repository';

/** @mentions in community chat: who a message may ping, and the member list the @ autocomplete offers. */
@Injectable()
export class CommunityMentionsService {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly access: CommunityAccessService,
    private readonly mentions: MentionsService,
  ) {}

  /**
   * Members of this community named in the text, who are active and not blocked either way.
   * More than the allowed number of distinct handles is refused, so one message cannot ping a crowd.
   */
  async targetsFor(
    gameId: string,
    actorId: string,
    text: string,
  ): Promise<string[]> {
    const handles = extractMentionHandles(text, MAX_MENTIONS_PER_TEXT + 1);
    if (handles.length > MAX_MENTIONS_PER_TEXT) {
      throw new BadRequestException(
        `A message can mention at most ${MAX_MENTIONS_PER_TEXT} people`,
      );
    }
    if (handles.length === 0) return [];

    const memberIds = await this.repository.findMemberIdsByUsernames(
      gameId,
      handles,
    );
    return this.mentions.resolveTargets({
      text,
      actorId,
      canView: (userId) => Promise.resolve(memberIds.has(userId)),
    });
  }

  /** Queues the pings inside the transaction that saved the message; anyone already pinged for it is skipped. */
  publish(
    transaction: Prisma.TransactionClient,
    input: { targetIds: string[]; actorId: string; messageId: string },
  ) {
    return this.mentions.publishMentions(
      {
        targetIds: input.targetIds,
        actorId: input.actorId,
        entityType: 'COMMUNITY_MESSAGE',
        entityId: input.messageId,
      },
      transaction,
    );
  }

  /** Members whose name or handle starts like what was typed after the @. */
  async searchMembers(slug: string, query: string, userId: string | undefined) {
    const { user, game } = await this.access.scope(slug, userId);
    const items = await this.repository.searchMembers({
      gameId: game.id,
      viewerId: user.id,
      query: query.trim().replace(/^@/, ''),
      limit: COMMUNITY_MEMBER_SEARCH_LIMIT,
    });
    return { items };
  }
}
