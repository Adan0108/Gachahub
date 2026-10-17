import { Injectable } from '@nestjs/common';
import { BlocksService } from '../blocks/blocks.service';
import type { CommunityScope } from './community-access.service';
import {
  CommunityChatRepository,
  type CommunityMessageRow,
} from './community-chat.repository';
import { toCommunityMessage } from './community-message.mapper';

/** Turns stored messages into what one viewer is shown: badges for moderators, placeholders for people they blocked. */
@Injectable()
export class CommunityMessagePresenter {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly blocks: BlocksService,
  ) {}

  /** A page of messages by many people: two queries cover all of it. */
  async page(gameId: string, viewerId: string, rows: CommunityMessageRow[]) {
    const authorIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.author?.id, row.replyTo?.author?.id].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      ),
    ];
    const [moderatorIds, blockedIds] = await Promise.all([
      this.repository.findModeratorIds(gameId, authorIds),
      this.blocks.getBlockedIdsAmong(viewerId, authorIds),
    ]);
    return rows.map((row) =>
      toCommunityMessage(row, { moderatorIds, blockedIds }),
    );
  }

  /**
   * The message someone has just written or changed. When the viewer is the author, what is
   * needed is already known from their scope (their badge, and that they have not blocked
   * themselves), so only a quote of someone else costs a query.
   */
  async one(scope: CommunityScope, row: CommunityMessageRow) {
    const viewerId = scope.user.id;
    if (row.author && row.author.id !== viewerId) {
      const [message] = await this.page(scope.game.id, viewerId, [row]);
      return message;
    }

    const quoted = row.replyTo?.author?.id;
    const blockedIds =
      quoted && quoted !== viewerId
        ? await this.blocks.getBlockedIdsAmong(viewerId, [quoted])
        : new Set<string>();
    const moderatorIds = new Set<string>(
      scope.canModerate && row.author ? [row.author.id] : [],
    );
    return toCommunityMessage(row, { moderatorIds, blockedIds });
  }
}
