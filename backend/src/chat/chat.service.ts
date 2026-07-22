import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatMessageContentType,
  ChatParticipantState,
  Prisma,
} from '../generated/prisma/client';
import { ChatRepository } from './chat.repository';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import { ReactToMessageDto } from './dto/react-to-message.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    @Inject(MESSAGE_ENCRYPTION_PORT)
    private readonly messageEncryption: MessageEncryptionPort,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  async createDirectMessage(senderId: string, dto: CreateDirectMessageDto) {
    if (senderId === dto.recipientUserId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const recipient = await this.chatRepository.findUserById(
      dto.recipientUserId,
    );

    if (!recipient || recipient.status !== 'ACTIVE') {
      throw new NotFoundException('Recipient not found');
    }

    const existingMessage =
      await this.chatRepository.findMessageBySenderClientMessageId(
        senderId,
        dto.message.clientMessageId,
      );

    if (existingMessage) {
      return {
        conversationId: existingMessage.conversationId,
        message: existingMessage,
        duplicate: true,
      };
    }

    const [userIdA, userIdB] = this.normalizeDirectPair(
      senderId,
      dto.recipientUserId,
    );

    const preparedPayload = await this.messageEncryption.preparePayload(
      dto.message,
    );

    const existingPair = await this.chatRepository.findDirectPair(
      userIdA,
      userIdB,
    );

    if (existingPair) {
      return this.sendMessageToExistingConversation(
        senderId,
        existingPair.conversation.id,
        {
          message: dto.message,
        },
        preparedPayload,
      );
    }

    const result =
      await this.chatRepository.createDirectConversationWithMessage({
        senderId,
        recipientUserId: dto.recipientUserId,
        userIdA,
        userIdB,
        recipientState: 'PENDING',
        ciphertext: preparedPayload.ciphertext,
        encryptionMeta: preparedPayload.encryptionMeta as
          | Prisma.InputJsonValue
          | undefined,
        contentType: dto.message.contentType ?? ChatMessageContentType.TEXT,
        clientMessageId: dto.message.clientMessageId,
        replyToId: dto.message.replyToId,
      });

    await this.chatDelivery.publishMessageCreated({
      conversationId: result.conversation.id,
      messageId: result.message.id,
      senderId,
      recipientUserIds: [dto.recipientUserId],
      shouldNotify: false,
    });

    return {
      conversationId: result.conversation.id,
      message: result.message,
      recipientState: 'PENDING',
    };
  }

  async listConversations(userId: string) {
    const conversations = await this.chatRepository.findInboxConversations(
      userId,
      'ACTIVE',
    );

    return Promise.all(
      conversations.map((conversation) =>
        this.toConversationSummary(conversation, userId),
      ),
    );
  }

  async listMessageRequests(userId: string) {
    const conversations = await this.chatRepository.findInboxConversations(
      userId,
      'PENDING',
    );

    return Promise.all(
      conversations.map((conversation) =>
        this.toConversationSummary(conversation, userId),
      ),
    );
  }

  async findMessages(
    userId: string,
    conversationId: string,
    query: QueryChatMessagesDto,
  ) {
    await this.assertReadableParticipant(conversationId, userId);

    const messages = await this.chatRepository.findMessages({
      conversationId,
      beforeMessageId: query.beforeMessageId,
      limit: query.limit ?? 30,
    });
    const nextBeforeMessageId = messages.at(-1)?.id ?? null;

    return {
      items: messages.reverse(),
      meta: {
        limit: query.limit ?? 30,
        nextBeforeMessageId,
      },
    };
  }

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    const preparedPayload = await this.messageEncryption.preparePayload(
      dto.message,
    );

    return this.sendMessageToExistingConversation(
      senderId,
      conversationId,
      dto,
      preparedPayload,
    );
  }

  async acceptRequest(userId: string, conversationId: string) {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    if (participant.state !== 'PENDING') {
      throw new BadRequestException('Conversation is not pending');
    }

    return this.chatRepository.updateParticipantState(
      conversationId,
      userId,
      'ACTIVE',
    );
  }

  async declineRequest(userId: string, conversationId: string) {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    if (participant.state !== 'PENDING') {
      throw new BadRequestException('Conversation is not pending');
    }

    return this.chatRepository.updateParticipantState(
      conversationId,
      userId,
      'DECLINED',
    );
  }

  async blockConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantState(
      conversationId,
      userId,
      'BLOCKED',
    );
  }

  async markDelivered(userId: string, dto: MarkMessagesDeliveredDto) {
    const result = await this.chatRepository.markMessagesDelivered(
      userId,
      dto.messageIds,
    );

    return {
      deliveredCount: result.count,
    };
  }

  async markRead(
    userId: string,
    conversationId: string,
    dto: MarkConversationReadDto,
  ) {
    await this.assertReadableParticipant(conversationId, userId);

    const result = await this.chatRepository.markConversationRead({
      conversationId,
      userId,
      lastReadMessageId: dto.lastReadMessageId,
    });

    return {
      readCount: result.count,
    };
  }

  async reactToMessage(
    userId: string,
    messageId: string,
    dto: ReactToMessageDto,
  ) {
    await this.assertCanInteractWithMessage(userId, messageId);

    return this.chatRepository.upsertMessageReaction({
      messageId,
      userId,
      type: dto.type,
    });
  }

  async removeReaction(userId: string, messageId: string) {
    await this.assertCanInteractWithMessage(userId, messageId);

    const result = await this.chatRepository.deleteMessageReaction(
      messageId,
      userId,
    );

    return {
      removedCount: result.count,
    };
  }

  private async sendMessageToExistingConversation(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
    preparedPayload?: {
      ciphertext: string;
      encryptionMeta?: Record<string, unknown>;
    },
  ) {
    const existingMessage =
      await this.chatRepository.findMessageBySenderClientMessageId(
        senderId,
        dto.message.clientMessageId,
      );

    if (existingMessage) {
      return {
        conversationId: existingMessage.conversationId,
        message: existingMessage,
        duplicate: true,
      };
    }

    const senderParticipant = await this.chatRepository.findParticipant(
      conversationId,
      senderId,
    );

    if (!senderParticipant) {
      throw new NotFoundException('Conversation not found');
    }

    if (senderParticipant.state !== 'ACTIVE') {
      throw new ForbiddenException('You cannot send messages here');
    }

    const participants =
      await this.chatRepository.findParticipants(conversationId);

    const blockedOrDeclinedRecipient = participants.find(
      (participant) =>
        participant.userId !== senderId &&
        ['BLOCKED', 'DECLINED'].includes(participant.state),
    );

    if (blockedOrDeclinedRecipient) {
      throw new ForbiddenException('Recipient is not accepting messages');
    }

    const payload =
      preparedPayload ??
      (await this.messageEncryption.preparePayload(dto.message));

    const message = await this.chatRepository.createMessage({
      conversationId,
      senderId,
      participantUserIds: participants.map((participant) => participant.userId),
      ciphertext: payload.ciphertext,
      encryptionMeta: payload.encryptionMeta as
        | Prisma.InputJsonValue
        | undefined,
      contentType: dto.message.contentType ?? ChatMessageContentType.TEXT,
      clientMessageId: dto.message.clientMessageId,
      replyToId: dto.message.replyToId,
    });

    const recipientParticipants = participants.filter(
      (participant) => participant.userId !== senderId,
    );

    await this.chatDelivery.publishMessageCreated({
      conversationId,
      messageId: message.id,
      senderId,
      recipientUserIds: recipientParticipants.map(
        (participant) => participant.userId,
      ),
      shouldNotify: recipientParticipants.every(
        (participant) => participant.state === 'ACTIVE' && !participant.mutedAt,
      ),
    });

    return {
      conversationId,
      message,
      duplicate: false,
    };
  }

  private async assertReadableParticipant(
    conversationId: string,
    userId: string,
  ) {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    if (!this.canReadState(participant.state)) {
      throw new ForbiddenException('You cannot read this conversation');
    }

    return participant;
  }

  private async assertCanInteractWithMessage(userId: string, messageId: string) {
    const message =
      await this.chatRepository.findMessageWithParticipants(messageId);

    if (!message || message.status !== 'SENT') {
      throw new NotFoundException('Message not found');
    }

    const participant = message.conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant || !this.canReadState(participant.state)) {
      throw new ForbiddenException('You cannot react to this message');
    }

    return message;
  }

  private canReadState(state: ChatParticipantState) {
    return ['ACTIVE', 'PENDING', 'ARCHIVED'].includes(state);
  }

  private normalizeDirectPair(userIdOne: string, userIdTwo: string) {
    return [userIdOne, userIdTwo].sort() as [string, string];
  }

  private async toConversationSummary(
    conversation: Awaited<
      ReturnType<ChatRepository['findInboxConversations']>
    >[number],
    userId: string,
  ) {
    const currentParticipant = conversation.participants.find(
      (participant) => participant.userId === userId,
    );
    const lastMessage = conversation.messages[0] ?? null;
    const unreadCount = await this.chatRepository.countUnreadMessages(
      conversation.id,
      userId,
    );

    return {
      id: conversation.id,
      type: conversation.type,
      status: conversation.status,
      participantState: currentParticipant?.state ?? null,
      participants: conversation.participants.map((participant) => ({
        userId: participant.userId,
        role: participant.role,
        state: participant.state,
        mutedAt: participant.mutedAt,
        user: participant.user,
      })),
      lastMessage,
      unreadCount,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  }
}
