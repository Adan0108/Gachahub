import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { ReactToMessageDto } from '../chat/dto/react-to-message.dto';
import {
  MESSAGE_EDIT_WINDOW_MS,
  isEditWindowOpen,
} from '../chat/message-edit-policy';
import { MediaService } from '../media/media.service';
import { CommunityAccessService } from './community-access.service';
import { CommunityChatRepository } from './community-chat.repository';
import { toCommunityReactions } from './community-message.mapper';
import { CommunityMessagePresenter } from './community-message.presenter';
import { CommunityMentionsService } from './community-mentions.service';
import { CommunityRealtimeService } from './community-realtime.service';
import type { DeleteCommunityMessageDto } from './dto/delete-community-message.dto';
import type { EditCommunityMessageDto } from './dto/edit-community-message.dto';
import { validMessageContent } from './utils/valid-message-content';

/** What people do to a message once it is posted: edit it, remove it, react to it. */
@Injectable()
export class CommunityActionsService {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly access: CommunityAccessService,
    private readonly presenter: CommunityMessagePresenter,
    private readonly realtime: CommunityRealtimeService,
    private readonly media: MediaService,
    private readonly mentions: CommunityMentionsService,
  ) {}

  async edit(
    slug: string,
    messageId: string,
    dto: EditCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId, true);
    const message = await this.access.messageIn(scope.game.id, messageId);

    if (message.authorId !== scope.user.id) {
      throw new ForbiddenException('You can only edit your own message');
    }
    if (message.deletedAt) {
      throw new BadRequestException('This message was removed');
    }
    if (!isEditWindowOpen(message.createdAt)) {
      throw new BadRequestException(
        `Messages can only be edited for ${MESSAGE_EDIT_WINDOW_MS / 60_000} minutes`,
      );
    }

    const content = validMessageContent(dto.content, message.media.length > 0);
    if (content === message.content) return this.presenter.one(scope, message);

    // Only people newly named by this edit are pinged: the mentions table remembers who already was
    const targetIds = await this.mentions.targetsFor(
      scope.game.id,
      scope.user.id,
      content,
    );
    const updated = await this.repository.updateContent(
      message.id,
      content,
      targetIds.length > 0
        ? (tx, saved) =>
            this.mentions.publish(tx, {
              targetIds,
              actorId: scope.user.id,
              messageId: saved.id,
            })
        : undefined,
    );
    await this.realtime.changed(message.channelId, message.id);
    return this.presenter.one(scope, updated);
  }

  /** Authors remove their own messages; moderators and admins remove anyone's. Removed text stays stored but is never returned. */
  async remove(
    slug: string,
    messageId: string,
    dto: DeleteCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId, true);
    const message = await this.access.messageIn(scope.game.id, messageId);

    const isOwn = message.authorId === scope.user.id;
    if (!isOwn && !scope.canModerate) {
      throw new ForbiddenException('You can only remove your own message');
    }
    if (message.deletedAt) return this.presenter.one(scope, message);

    const reason = isOwn ? undefined : dto.reason?.trim() || undefined;
    const removed = await this.repository.softDelete(
      message.id,
      scope.user.id,
      reason,
    );
    await this.realtime.changed(message.channelId, message.id);
    // Pictures are not kept as evidence: the files are destroyed, a failure is retried hourly
    await Promise.all(
      message.media.map((item) =>
        this.media.releaseReplacedUpload(item.mediaUploadId),
      ),
    );
    return this.presenter.one(scope, removed);
  }

  /** One reaction per person per message; choosing again replaces the last one. */
  async react(
    slug: string,
    messageId: string,
    dto: ReactToMessageDto,
    userId: string | undefined,
  ) {
    const { user, game } = await this.access.scope(slug, userId, true);
    const message = await this.access.messageIn(game.id, messageId);
    if (message.deletedAt) {
      throw new BadRequestException('This message was removed');
    }

    if (dto.emoteId) {
      const emote = await this.repository.findUsableEmote(dto.emoteId, game.id);
      if (!emote)
        throw new ForbiddenException('That emote is not available here');
    }

    await this.repository.upsertReaction({
      messageId: message.id,
      userId: user.id,
      emoji: dto.emoji,
      emoteId: dto.emoteId,
    });
    await this.realtime.changed(message.channelId, message.id);
    return this.reactionsOf(message.id);
  }

  async unreact(slug: string, messageId: string, userId: string | undefined) {
    const { user, game } = await this.access.scope(slug, userId, true);
    const message = await this.access.messageIn(game.id, messageId);

    await this.repository.deleteReaction(message.id, user.id);
    await this.realtime.changed(message.channelId, message.id);
    return this.reactionsOf(message.id);
  }

  /** The answer to a reaction request is the message's reactions alone: nothing else about it changed. */
  private async reactionsOf(messageId: string) {
    return toCommunityReactions(
      messageId,
      await this.repository.findReactions(messageId),
    );
  }
}
