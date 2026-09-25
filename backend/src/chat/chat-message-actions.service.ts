import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { GamesService } from '../games/games.service';
import { MediaService } from '../media/media.service';
import { CreateChatEmoteDto } from './dto/create-chat-emote.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ReactToMessageDto } from './dto/react-to-message.dto';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

/**
 * Message-level actions after the initial send: reactions, edits, deletes,
 * game emotes, and typing-indicator recipients. Pulled out of the former
 * monolithic ChatService as its own concern - each of these operates on one
 * existing message or conversation's participant list, not on the send
 * pipeline or inbox listing.
 */
@Injectable()
export class ChatMessageActionsService {
  private readonly logger = new Logger(ChatMessageActionsService.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    private readonly gamesService: GamesService,
    private readonly mediaService: MediaService,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  /**
   * Creates a custom emote for one game community.
   *
   * This endpoint stores final asset metadata only. Upload/crop/rotate/resize
   * can later be implemented by a dedicated media service without changing
   * reaction storage.
   */
  async createGameEmote(
    userId: string,
    gameId: string,
    dto: CreateChatEmoteDto,
  ) {
    const game = await this.gamesService.findById(gameId);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    await this.chatAccessService.assertCanManageGameEmotes(userId, gameId);

    if (!dto.unicode && !dto.imageUrl && !dto.animationUrl) {
      throw new BadRequestException(
        'Emote requires unicode, imageUrl, or animationUrl',
      );
    }

    return this.chatRepository.createGameChatEmote({
      gameId,
      createdById: userId,
      shortcode: dto.shortcode,
      unicode: dto.unicode,
      imageUrl: dto.imageUrl,
      animationUrl: dto.animationUrl,
      width: dto.width,
      height: dto.height,
      fileSize: dto.fileSize,
      mimeType: dto.mimeType,
    });
  }

  /**
   * Sets the user's reaction on a message, replacing any existing one, then broadcasts it.
   */
  async reactToMessage(
    userId: string,
    messageId: string,
    dto: ReactToMessageDto,
  ) {
    const message = await this.chatAccessService.assertCanInteractWithMessage(
      userId,
      messageId,
    );

    const emoji = dto.emoji?.trim();
    const emoteId = dto.emoteId?.trim();

    if (!emoji && !emoteId) {
      throw new BadRequestException('Reaction requires emoji or emoteId');
    }

    if (emoji && emoteId) {
      throw new BadRequestException('Reaction can only use emoji or emoteId');
    }

    if (emoteId) {
      await this.chatAccessService.assertCanUseEmote(userId, emoteId);
    }

    const reaction = await this.chatRepository.upsertMessageReaction({
      messageId,
      userId,
      emoji: emoji ?? null,
      emoteId: emoteId ?? null,
    });

    await this.chatDelivery.publishReactionAdded({
      conversationId: message.conversationId,
      messageId,
      actorId: userId,
      recipientUserIds: this.chatAccessService.getDeliverableRecipientIds(
        message.conversation,
        userId,
      ),
    });

    return reaction;
  }

  /**
   * Removes the current user's reaction from a message.
   *
   * Publishes a real-time event only when a reaction actually existed.
   */
  async removeReaction(userId: string, messageId: string) {
    const message = await this.chatAccessService.assertCanInteractWithMessage(
      userId,
      messageId,
    );

    const result = await this.chatRepository.deleteMessageReaction(
      messageId,
      userId,
    );

    // only broadcast when a reaction actually existed, no false events for no-ops
    if (result.count > 0) {
      await this.chatDelivery.publishReactionRemoved({
        conversationId: message.conversationId,
        messageId,
        actorId: userId,
        recipientUserIds: this.chatAccessService.getDeliverableRecipientIds(
          message.conversation,
          userId,
        ),
      });
    }

    return {
      removedCount: result.count,
    };
  }

  /**
   * Edits the current user's own encrypted message.
   *
   * Business behavior:
   * - Only the original sender can edit.
   * - Deleted messages cannot be edited.
   * - Edited message gets a new encrypted payload and editedAt timestamp.
   * - Publishes a real-time event to other participants.
   */
  async editMessage(userId: string, messageId: string, dto: EditMessageDto) {
    const message = await this.chatAccessService.assertCanModifyOwnMessage(
      userId,
      messageId,
    );

    this.chatAccessService.assertNoMembershipChangePending(
      message.conversation.participants,
    );

    const updated = await this.chatRepository.updateMessage({
      messageId,
      ciphertext: dto.ciphertext,
      encryptionMeta: dto.encryptionMeta as Prisma.InputJsonValue | undefined,
      contentType: dto.contentType,
    });

    await this.chatDelivery.publishMessageEdited({
      conversationId: message.conversationId,
      messageId,
      actorId: userId,
      recipientUserIds: this.chatAccessService.getDeliverableRecipientIds(
        message.conversation,
        userId,
      ),
    });

    return updated;
  }

  /**
   * Soft deletes the current user's own message.
   *
   * The message row remains, but encrypted content is cleared and status becomes
   * DELETED. Any attached media is released too, same "drop the substance,
   * keep the row" treatment as the ciphertext. Publishes a real-time event to
   * other participants.
   */
  async deleteMessage(userId: string, messageId: string) {
    const message = await this.chatAccessService.assertCanModifyOwnMessage(
      userId,
      messageId,
    );

    await this.chatRepository.softDeleteMessage(messageId);
    await this.releaseDeletedMessageMedia(message.media);

    await this.chatDelivery.publishMessageDeleted({
      conversationId: message.conversationId,
      messageId,
      actorId: userId,
      recipientUserIds: this.chatAccessService.getDeliverableRecipientIds(
        message.conversation,
        userId,
      ),
    });

    return {
      message: 'Message deleted successfully',
    };
  }

  /**
   * Resolves who should receive a typing indicator from this user.
   *
   * Called by the websocket gateway, not exposed as a REST route.
   */
  async getTypingRecipients(
    conversationId: string,
    userId: string,
  ): Promise<string[]> {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (
      !participant ||
      participant.deletedAt ||
      !this.chatAccessService.canShowTypingState(participant.state)
    ) {
      return [];
    }

    const participants =
      await this.chatRepository.findParticipants(conversationId);

    return participants
      .filter(
        (otherParticipant) =>
          otherParticipant.userId !== userId &&
          !otherParticipant.deletedAt &&
          this.chatAccessService.canShowTypingState(otherParticipant.state),
      )
      .map((otherParticipant) => otherParticipant.userId);
  }

  /**
   * Releases each attachment's underlying upload after its message is deleted.
   *
   * Best-effort on purpose: deleting the message content is the user's actual
   * intent, so a Cloudinary hiccup on one attachment must not fail the whole
   * delete. A failed release is flagged RELEASE_FAILED so
   * ChatMediaReleaseRetryService picks it back up on a backoff instead of it
   * sitting ATTACHED - permanently excluded from cleanup - forever.
   */
  private async releaseDeletedMessageMedia(
    media: Array<{ mediaUploadId: string }> = [],
  ) {
    for (const item of media) {
      try {
        const released = await this.mediaService.destroyAttachedCloudinaryAsset(
          item.mediaUploadId,
        );

        if (released) {
          // one transaction: a crash here can't leave the link row behind
          // pointing at an upload we already marked DELETED
          await this.chatRepository.finalizeReleasedMedia(item.mediaUploadId);
        } else {
          await this.chatRepository.deleteMessageMediaByUploadId(
            item.mediaUploadId,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to release media ${item.mediaUploadId} after deleting message`,
          error instanceof Error ? error.stack : undefined,
        );

        // flag for ChatMediaReleaseRetryService instead of leaving it stuck
        // ATTACHED - permanently excluded from cleanup - forever
        await this.mediaService
          .markReleaseFailed(item.mediaUploadId)
          .catch((markError) => {
            this.logger.warn(
              `Failed to flag media ${item.mediaUploadId} for release retry`,
              markError instanceof Error ? markError.stack : undefined,
            );
          });
      }
    }
  }
}
