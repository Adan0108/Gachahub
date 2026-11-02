import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isUniqueViolationOn } from '../chat/prisma-unique-violation';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { MediaService } from '../media/media.service';
import { CommunityAccessService } from './community-access.service';
import { CommunityChatRateLimiterService } from './community-chat-rate-limiter.service';
import { COMMUNITY_MESSAGE_MAX_IMAGES } from './community-chat.constants';
import { CommunityChatRepository } from './community-chat.repository';
import { CommunityMentionsService } from './community-mentions.service';
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
    private readonly media: MediaService,
    private readonly mentions: CommunityMentionsService,
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

  /** One message as this person sees it, so a client can refresh just the one that changed. */
  async getMessage(
    slug: string,
    messageId: string,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId);
    const message = await this.access.messageIn(scope.game.id, messageId);
    return this.presenter.one(scope, message);
  }

  async send(
    slug: string,
    channelId: string,
    dto: SendCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId, true);
    const { user, game, canModerate } = scope;
    const channel = await this.access.channelIn(game.id, channelId);
    const mediaIds = dto.mediaUploadIds ?? [];
    const content = validMessageContent(dto.content ?? '', mediaIds.length > 0);

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

    const resolved = await this.media.resolveAttachableMedia({
      ids: mediaIds,
      userId: user.id,
      purpose: 'COMMUNITY',
      maxImages: COMMUNITY_MESSAGE_MAX_IMAGES,
      maxVideos: 0,
      entityLabel: 'community message',
    });
    // Shown in the order the sender picked them, not the order the database returned them
    const images = mediaIds.map(
      (id) => resolved.find((image) => image.id === id)!,
    );

    const targetIds = await this.mentions.targetsFor(game.id, user.id, content);

    try {
      // Moderators are exempt from slow mode; for everyone else the wait is checked as the message is saved.
      const saved = await this.repository.createMessage(
        {
          channelId: channel.id,
          authorId: user.id,
          content,
          replyToId: dto.replyToId,
          clientMessageId: dto.clientMessageId,
        },
        canModerate ? 0 : channel.slowmodeSeconds,
        images.map((image) => ({
          mediaUploadId: image.id,
          publicId: image.publicId,
          url: image.secureUrl!,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          format: image.format,
        })),
        targetIds.length > 0
          ? (tx, created) =>
              this.mentions.publish(tx, {
                targetIds,
                actorId: user.id,
                messageId: created.id,
              })
          : undefined,
      );
      if ('waitMs' in saved) throwSlowMode(saved.waitMs);

      await this.realtime.changed(channel.id, saved.created.id);
      return await this.presenter.one(scope, saved.created);
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
}

function throwSlowMode(waitMs: number): never {
  const seconds = Math.ceil(waitMs / 1000);
  throw new RateLimitedException(
    `Slow mode is on, wait ${seconds}s before sending again`,
    seconds,
  );
}
