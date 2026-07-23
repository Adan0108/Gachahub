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
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import { ReactToMessageDto } from './dto/react-to-message.dto';

/**
 * Service responsible for chat business logic.
 *
 * This layer decides who can send, read, accept, decline, block, and react.
 *
 * Database details stay in ChatRepository, while delivery/encryption behavior
 * is accessed through ports so it can be replaced later.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    @Inject(MESSAGE_ENCRYPTION_PORT)
    private readonly messageEncryption: MessageEncryptionPort,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  /**
   * Creates or reuses a direct convo and sends a first encrypted message.
   *
   * Business behavior:
   * - Users cannot mesage themselves.
   * - Recipient must exist and be active.
   * - clientMessageId prevents duplicate sends when clients retry.
   * - A new direct convo starts with the recipient in PENDING state.
   * - Pending stranger messages are stored but should not notify the receiver.
   */
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

    if (dto.message.replyToId) {
      throw new BadRequestException('Reply target is not in this conversation');
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

  /**
   * Lists normal inbox conversations for a user.
   *
   * Only ACTIVE participant records are returned here.
   * Pending stranger messages are listed separately.
   */
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

  /**
   * Lists pending stranger message requests for a user.
   *
   * The receiver can preview encrypted message payloads from this list before
   * choosing to accept or decline the convo
   */
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

  /**
   * Lists encrypted messages in a convo
   *
   * Business behavior:
   * - User must be allowed to read the convo
   * - Messages are loaded newest-fisrt from the database for pagination
   * - The response reverses them back into chronological order for clients
   */
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

  /**
   * Send an encrypted message to an existing convo
   *
   * The encryption port keeps message handling opaque to the backend
   * Service logic only validates chat rules and passes ciphertext to the repository.
   */
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

  /**
   * Accepts a pending stranger convo.
   *
   * Only the pending recipient can accept. After acceptance, the patricipant is
   * moved into ACTIVE state and future messages can behave like normal inbox messages.
   */
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

  /**
   * Declines a pending convo.
   *
   * Declining keeps the conversation record for audit/history behavior, but
   * marks the participant as DECLINED so future sends are rejected.
   */
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

  /**
   * Blocks a convo for the current user.
   *
   * Blocking is stored on the participant row because chat safety state is
   * user-specific, not global to the convo.
   */
  async blockConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantState(
      conversationId,
      userId,
      'BLOCKED',
    );
  }

  /**
   * Marks messages as delivered to the current user's device.
   *
   * This supports offline users: messages can be SENT in the database before
   * the recipient comes online and acklnwedge delivery.
   */
  async markDelivered(userId: string, dto: MarkMessagesDeliveredDto) {
    const result = await this.chatRepository.markMessagesDelivered(
      userId,
      dto.messageIds,
    );

    return {
      deliveredCount: result.count,
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

  /**
   * Adds or updates the current user's reaction on a message.
   *
   * Business behavior:
   * - User must be able to read the message's convoi.
   * - Deleted messages cannot be reacted to.
   * - One user gets one reaction per message; another reaction replaces it.
   */
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

  /**
   * Removes the current user's reaction from a message.
   *
   * The permission check matches reactToMessage so users cannot reveal or
   * modify reaction state for messages outside conversations they can access.
   */
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

  /**
   * Edits the current user's own encrypted message.
   *
   * Business behavior:
   * - Only the original sender can edit.
   * - Deleted messages cannot be edited.
   * - Edited message gets a new encrypted payload and editedAt timestamp.
   */
  async editMessage(userId: string, messageId: string, dto: EditMessageDto) {
    await this.assertCanModifyOwnMessage(userId, messageId);

    return this.chatRepository.updateMessage({
      messageId,
      ciphertext: dto.ciphertext,
      encryptionMeta: dto.encryptionMeta as
        | Prisma.InputJsonValue
        | undefined,
      contentType: dto.contentType ?? ChatMessageContentType.TEXT,
    });
  }

  /**
   * Soft deletes the current user's own message.
   *
   * The message row remains, but encrypted content is cleared and status becomes
   * DELETED.
   */
  async deleteMessage(userId: string, messageId: string) {
    await this.assertCanModifyOwnMessage(userId, messageId);

    await this.chatRepository.softDeleteMessage(messageId);

    return {
      message: 'Message deleted successfully',
    };
  }

  /**
   * Shared implementation for sending into an existing convo.
   *
   * This keeps the duplicate-send, participant-state, blocked/declined, message
   * creation, and delivery hook behavior in one place for both first-message and
   * follow-up-message flows.
   */
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

    await this.assertValidReplyTarget(conversationId, dto.message.replyToId);

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

  private async assertValidReplyTarget(
    conversationId: string,
    replyToId?: string,
  ) {
    if (!replyToId) {
      return;
    }

    const replyTarget = await this.chatRepository.findSentMessageInConversation(
      replyToId,
      conversationId,
    );

    if (!replyTarget) {
      throw new BadRequestException('Reply target message was not found');
    }
  }

  /**
   * Verifies the user can read a conversation.
   *
   * PENDING is readable so users can preview stranger requests. BLOCKED and
   * DECLINED are not readable through normal chat endpoints.
   */
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

  /**
   * Verifies the user can interact with a specific message.
   *
   * Reactions are message-level action, but permision is based on whether the
   * user can read the message's parent convo
   */
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

  /**
   * Verifies the current user can edit/delete a message.
   *
   * Message modification is stricter than reacting: users can react to messages
   * they can read, but they can only edit/delete messages they sent.
   */
  private async assertCanModifyOwnMessage(userId: string, messageId: string) {
    const message =
      await this.chatRepository.findMessageWithParticipants(messageId);

    if (!message || message.status !== 'SENT') {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only modify your own messages');
    }

    const participant = message.conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant || !this.canReadState(participant.state)) {
      throw new ForbiddenException('You cannot modify this message');
    }

    return message;
  }

  /**
   * Central list of participant states that can read messages.
   *
   * Keep this helper small so future states, such as MUTED or LIMITED, can be
   * added without hunting through every chat operation.
   */
  private canReadState(state: ChatParticipantState) {
    return ['ACTIVE', 'PENDING', 'ARCHIVED'].includes(state);
  }

  /**
   * Sorts user ids before storing a direct chat pair.
   *
   * A->B and B->A resolve to the same unique database pair,
   * ==> prevents duplicate direct conversations between the same users.
   */
  private normalizeDirectPair(userIdOne: string, userIdTwo: string) {
    return [userIdOne, userIdTwo].sort() as [string, string];
  }

  /**
   * Converts a convo record into an inbox/request list item.
   *
   * The summary includes participant info, latest encrypted message payload,
   * unread count, and timestamps needed by the frontend inbox UI.
   */
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
