import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isUniqueViolationOn } from '../chat/prisma-unique-violation';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { CommunityAccessService } from './community-access.service';
import { CommunityChatRateLimiterService } from './community-chat-rate-limiter.service';
import { CommunityChatRepository } from './community-chat.repository';
import { CommunityMessagePresenter } from './community-message.presenter';
import { CommunityRealtimeService } from './community-realtime.service';
import type { QueryCommunityMessagesDto } from './dto/query-community-messages.dto';
import type { SendCommunityMessageDto } from './dto/send-community-message.dto';
import { validMessageContent } from './utils/valid-message-content';

/** Reading a room's history and posting to it. */
@Injectable()
export class CommunityMessagingService {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly access: CommunityAccessService,
    private readonly rateLimiter: CommunityChatRateLimiterService,
    private readonly presenter: CommunityMessagePresenter,
    private readonly realtime: CommunityRealtimeService,
  ) {}

  /** A page of history, oldest first; `before` loads the page above the one you have. */
  async listMessages(
    slug: string,
    channelId: string,
    query: QueryCommunityMessagesDto,
    userId: string | undefined,
  ) {
    const { user, game } = await this.access.scope(slug, userId);
    const channel = await this.access.channelIn(game.id, channelId);

    let before: { id: string; createdAt: Date } | null = null;
    if (query.before) {
      before = await this.repository.findCursor(channel.id, query.before);
      if (!before)
        throw new BadRequestException('Unknown message to load before');
    }

    const rows = await this.repository.listMessages({
      channelId: channel.id,
      before,
      limit: query.limit,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();

    return {
      items: await this.presenter.page(game.id, user.id, page),
      hasMore,
    };
  }

  async send(
    slug: string,
    channelId: string,
    dto: SendCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId);
    const { user, game, canModerate } = scope;
    const channel = await this.access.channelIn(game.id, channelId);
    const content = validMessageContent(dto.content);

    // A retry of a send that already went through returns that message, not a second one.
    if (dto.clientMessageId) {
      const existing = await this.repository.findByClientMessageId(
        user.id,
        dto.clientMessageId,
      );
      if (existing) {
        if (existing.channelId !== channel.id) {
          throw new ConflictException(
            'This clientMessageId was already used in another channel',
          );
        }
        return this.presenter.one(scope, existing);
      }
    }

    if (!canModerate) {
      if (channel.kind === 'ANNOUNCEMENT') {
        throw new ForbiddenException(
          'Only moderators can post in this channel',
        );
      }
      if (channel.isLocked) {
        throw new ForbiddenException('This channel is locked');
      }
      this.rateLimiter.assertNotRateLimited(user.id, channel.id);
      await this.assertSlowmodeElapsed(channel, user.id);
    }

    if (dto.replyToId) {
      const target = await this.repository.findMessageInChannel(
        dto.replyToId,
        channel.id,
      );
      if (!target) {
        throw new BadRequestException('Reply target is not in this channel');
      }
    }

    try {
      const created = await this.repository.createMessage({
        channelId: channel.id,
        authorId: user.id,
        content,
        replyToId: dto.replyToId,
        clientMessageId: dto.clientMessageId,
      });
      this.realtime.changed(channel.id);
      return await this.presenter.one(scope, created);
    } catch (error) {
      // Two sends with one client id at once: the loser gets the winner's message.
      if (
        dto.clientMessageId &&
        isUniqueViolationOn(error, 'clientMessageId')
      ) {
        const existing = await this.repository.findByClientMessageId(
          user.id,
          dto.clientMessageId,
        );
        if (existing) return this.presenter.one(scope, existing);
      }
      throw error;
    }
  }

  private async assertSlowmodeElapsed(
    channel: { id: string; slowmodeSeconds: number },
    userId: string,
  ) {
    if (channel.slowmodeSeconds <= 0) return;

    const last = await this.repository.lastMessageAtBy(channel.id, userId);
    if (!last) return;

    const waitMs =
      channel.slowmodeSeconds * 1000 - (Date.now() - last.getTime());
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new RateLimitedException(
        `Slow mode is on, wait ${seconds}s before sending again`,
        seconds,
      );
    }
  }
}
