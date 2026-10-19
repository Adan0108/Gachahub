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
import { CommunityAccessService } from './community-access.service';
import { CommunityChatRepository } from './community-chat.repository';
import { toCommunityReactions } from './community-message.mapper';
import { CommunityMessagePresenter } from './community-message.presenter';
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
  ) {}

  async edit(
    slug: string,
    messageId: string,
    dto: EditCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId);
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

    const content = validMessageContent(dto.content);
    if (content === message.content) return this.presenter.one(scope, message);

    const updated = await this.repository.updateContent(message.id, content);
    this.realtime.changed(message.channelId, message.id);
    return this.presenter.one(scope, updated);
  }

  /** Authors remove their own messages; moderators and admins remove anyone's. Removed text stays stored but is never returned. */
  async remove(
    slug: string,
    messageId: string,
    dto: DeleteCommunityMessageDto,
    userId: string | undefined,
  ) {
    const scope = await this.access.scope(slug, userId);
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
    this.realtime.changed(message.channelId, message.id);
    return this.presenter.one(scope, removed);
  }

  /** One reaction per person per message; choosing again replaces the last one. */
  async react(
    slug: string,
    messageId: string,
    dto: ReactToMessageDto,
    userId: string | undefined,
  ) {
    const { user, game } = await this.access.scope(slug, userId);
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
    this.realtime.changed(message.channelId, message.id);
    return this.reactionsOf(message.id);
  }

  async unreact(slug: string, messageId: string, userId: string | undefined) {
    const { user, game } = await this.access.scope(slug, userId);
    const message = await this.access.messageIn(game.id, messageId);

    await this.repository.deleteReaction(message.id, user.id);
    this.realtime.changed(message.channelId, message.id);
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
