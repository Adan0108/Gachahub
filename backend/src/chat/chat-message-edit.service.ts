import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatAccessService } from './chat-access.service';
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { ChatRepository } from './chat.repository';
import { EditMessageDto } from './dto/edit-message.dto';
import {
  hasReachedEditLimit,
  isEditWindowOpen,
  MAX_EDITS_PER_MESSAGE,
  MESSAGE_EDIT_WINDOW_MS,
} from './message-edit-policy';
import { isUniqueViolationOn } from './prisma-unique-violation';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';
import type { MessageEncryptionPort } from './ports/message-encryption.port';

/**
 * Edits a text message. The new text arrives as a new encrypted message the other devices decrypt
 * like any other; here it is stored as a hidden EDIT message pointing at the original, and the
 * original is stamped edited. The backend only checks who may edit what, and when.
 */
@Injectable()
export class ChatMessageEditService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly chatMessageRateLimiter: ChatMessageRateLimiterService,
    @Inject(MESSAGE_ENCRYPTION_PORT)
    private readonly messageEncryption: MessageEncryptionPort,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
    private readonly prisma: PrismaService,
  ) {}

  /** Adds an edit to the user's own recent text message; a retry with the same clientMessageId returns the edit already stored. */
  async editMessage(
    userId: string,
    sessionId: string,
    messageId: string,
    dto: EditMessageDto,
  ) {
    await this.chatDevicesService.assertSessionLinkedToActiveDevice(
      userId,
      sessionId,
    );
    this.chatMessageRateLimiter.assertNotRateLimited(userId);

    const duplicate = await this.findDuplicate(userId, messageId, dto);
    if (duplicate) return duplicate;

    const target =
      await this.chatRepository.findMessageWithParticipants(messageId);
    if (!target || target.status !== 'SENT' || target.contentType === 'EDIT') {
      throw new NotFoundException('Message not found');
    }

    // Before ownership, so someone outside the conversation learns nothing about the message.
    await this.chatAccessService.assertSenderCanPost(
      target.conversation,
      userId,
    );

    if (target.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (target.contentType !== 'TEXT') {
      throw new BadRequestException({
        code: 'EDIT_NOT_SUPPORTED',
        message: 'Only text messages can be edited',
      });
    }
    if (!isEditWindowOpen(target.createdAt)) {
      throw new BadRequestException({
        code: 'EDIT_WINDOW_CLOSED',
        message: `Messages can only be edited for ${MESSAGE_EDIT_WINDOW_MS / 60_000} minutes after they are sent`,
      });
    }

    const payload = await this.messageEncryption.preparePayload(
      dto,
      target.conversationId,
    );
    const deliverableUserIds = target.conversation.participants
      .filter((participant) =>
        this.chatAccessService.isStateDeliveryEligible(
          target.conversation.type,
          participant.state,
        ),
      )
      .map((participant) => participant.userId);

    let edit: Awaited<ReturnType<ChatRepository['createEditMessage']>>;
    try {
      edit = await this.prisma.$transaction(async (tx) => {
        // The same lock a membership change takes, so a removal cannot slip in between the checks and the insert.
        const freshParticipants =
          await this.chatRepository.lockAndFindParticipants(
            tx,
            target.conversationId,
          );
        await this.chatAccessService.assertSenderCanPost(
          { type: target.conversation.type, participants: freshParticipants },
          userId,
        );

        // Stamping the original also locks it, so two edits (or an edit and an unsend) take turns.
        if (
          !(await this.chatRepository.markMessageEdited(
            tx,
            messageId,
            new Date(),
          ))
        ) {
          throw new NotFoundException('Message not found');
        }
        if (
          hasReachedEditLimit(
            await this.chatRepository.countEditsOfMessage(tx, messageId),
          )
        ) {
          throw new BadRequestException({
            code: 'EDIT_LIMIT_REACHED',
            message: `A message can be edited ${MAX_EDITS_PER_MESSAGE} times`,
          });
        }

        return this.chatRepository.createEditMessage(tx, {
          conversationId: target.conversationId,
          senderId: userId,
          participantUserIds: deliverableUserIds,
          editsMessageId: messageId,
          ciphertext: payload.ciphertext,
          encryptionMeta: payload.encryptionMeta as
            | Prisma.InputJsonValue
            | undefined,
          clientMessageId: dto.clientMessageId,
        });
      });
    } catch (error) {
      if (!isUniqueViolationOn(error, 'clientMessageId')) throw error;
      const raced = await this.findDuplicate(userId, messageId, dto);
      if (raced) return raced;
      throw error;
    }

    await this.chatDelivery.publishMessageEdited({
      conversationId: target.conversationId,
      messageId,
      actorId: userId,
      recipientUserIds: this.chatAccessService.getDeliverableRecipientIds(
        target.conversation,
        userId,
      ),
    });

    return {
      conversationId: target.conversationId,
      message: edit,
      duplicate: false,
    };
  }

  /** The edit already stored for this clientMessageId, if it is an edit of this same message. */
  private async findDuplicate(
    userId: string,
    messageId: string,
    dto: EditMessageDto,
  ) {
    const existing =
      await this.chatRepository.findMessageBySenderClientMessageId(
        userId,
        dto.clientMessageId,
      );
    if (!existing) return null;

    if (existing.editsMessageId !== messageId) {
      throw new ConflictException(
        'This clientMessageId was already used for something else',
      );
    }
    return {
      conversationId: existing.conversationId,
      message: existing,
      duplicate: true,
    };
  }
}
