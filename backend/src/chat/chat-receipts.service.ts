import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatAccessService } from './chat-access.service';
import { ChatRepository } from './chat.repository';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import type {
  ChatDeliveryPort,
  ChatReceiptsUpdatedEvent,
} from './ports/chat-delivery.port';
import { deliveryRecipientIds, readRecipientIds } from './receipt-recipients';
import type { ReceiptPartyRow } from './receipt-visibility';

/**
 * Delivered and read receipts: recording that this user's device received or read messages, and
 * telling the people who sent them (and may see it) as it happens.
 */
@Injectable()
export class ChatReceiptsService {
  private readonly logger = new Logger(ChatReceiptsService.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  /**
   * Marks messages as delivered to the current user's device.
   *
   * This supports offline users: messages can be SENT in the database before
   * the recipient comes online and acknowledge delivery.
   */
  async markDelivered(userId: string, dto: MarkMessagesDeliveredDto) {
    const delivered = await this.chatRepository.markMessagesDelivered(
      userId,
      dto.messageIds,
    );

    const messageIdsByConversation = new Map<string, string[]>();
    for (const { conversationId, messageId } of delivered) {
      const ids = messageIdsByConversation.get(conversationId) ?? [];
      ids.push(messageId);
      messageIdsByConversation.set(conversationId, ids);
    }
    await Promise.all(
      [...messageIdsByConversation].map(([conversationId, messageIds]) =>
        this.announceDelivered(userId, conversationId, messageIds),
      ),
    );

    return {
      deliveredCount: delivered.length,
    };
  }

  /**
   * Marks messages as read by the current user.
   *
   * Read state is stored per recipient. This works for direct messages now and
   * still works if the convo later grows into group/admin chat.
   */
  async markRead(
    userId: string,
    conversationId: string,
    dto: MarkConversationReadDto,
  ) {
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

    const result = await this.chatRepository.markConversationRead({
      conversationId,
      userId,
      lastReadMessageId: dto.lastReadMessageId,
    });

    if (result.count > 0 && result.lastReadMessage) {
      await this.announceRead(
        userId,
        conversationId,
        result.lastReadMessage.id,
      );
    }

    return {
      readCount: result.count,
    };
  }

  private announceDelivered(
    readerId: string,
    conversationId: string,
    messageIds: string[],
  ) {
    return this.announce(
      conversationId,
      (rows) => deliveryRecipientIds(rows, readerId),
      (recipientUserIds) => ({
        kind: 'delivered',
        conversationId,
        readerId,
        recipientUserIds,
        messageIds,
      }),
    );
  }

  private announceRead(
    readerId: string,
    conversationId: string,
    upToMessageId: string,
  ) {
    return this.announce(
      conversationId,
      (rows) => readRecipientIds(rows, readerId),
      (recipientUserIds) => ({
        kind: 'read',
        conversationId,
        readerId,
        recipientUserIds,
        upToMessageId,
        at: new Date(),
      }),
    );
  }

  /**
   * Tells the people `recipientsOf` picks, and nobody else. Best effort: the receipts are already
   * saved, so failing to announce them must not fail the request.
   */
  private async announce(
    conversationId: string,
    recipientsOf: (rows: ReceiptPartyRow[]) => string[],
    eventFor: (recipientUserIds: string[]) => ChatReceiptsUpdatedEvent,
  ) {
    try {
      const rows = await this.chatRepository.findReceiptParties(conversationId);
      const recipientUserIds = recipientsOf(rows);
      if (recipientUserIds.length === 0) return;

      await this.chatDelivery.publishReceiptsUpdated(
        eventFor(recipientUserIds),
      );
    } catch (error) {
      this.logger.warn(
        `Could not announce receipts for ${conversationId}`,
        error,
      );
    }
  }
}
