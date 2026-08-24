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
  UserRole,
  MessageRequestSetting,
} from '../generated/prisma/client';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { ChatRepository } from './chat.repository';
import { FollowsService } from '../follows/follows.service';
import { CreateChatEmoteDto } from './dto/create-chat-emote.dto';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ReactToMessageDto } from './dto/react-to-message.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { TransferGroupOwnershipDto } from './dto/transfer-group-ownership.dto';
import { UpdateGroupChatDto } from './dto/update-group-chat.dto';
import { UpdateGroupMembersDto } from './dto/update-group-members.dto';
import { UpdateGroupMemberRoleDto } from './dto/update-group-member-role.dto';
import { GamesService } from '../games/games.service';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

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
    private readonly followsService: FollowsService,
    private readonly gamesService: GamesService,
    private readonly gameModeratorsService: GameModeratorsService,
    @Inject(MESSAGE_ENCRYPTION_PORT)
    private readonly messageEncryption: MessageEncryptionPort,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
  ) {}

  /**
   * Creates or reuses a direct convo and sends a first encrypted message.
   *
   * Business behavior:
   * - Users cannot message themselves.
   * - Recipient must exist and be active.
   * - clientMessageId prevents duplicate sends when clients retry.
   * - A new direct convo starts with the recipient in PENDING state, unless
   *   sender and recipient mutually follow each other, in which case it
   *   starts ACTIVE for both — no stranger-request step needed.
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

    await this.assertSenderHasNotBlockedRecipient(
      senderId,
      dto.recipientUserId,
    );

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

    const areMutualFollowers = await this.assertMessageRequestAllowed(
      senderId,
      recipient,
    );

    const recipientState = areMutualFollowers ? 'ACTIVE' : 'PENDING';

    const shouldNotify = await this.isRecipientNotifiable('DIRECT', senderId, {
      userId: dto.recipientUserId,
      state: recipientState,
      notificationLevel: 'ALL',
      mutedUntil: null,
    });

    const result =
      await this.chatRepository.createDirectConversationWithMessage({
        senderId,
        recipientUserId: dto.recipientUserId,
        userIdA,
        userIdB,
        recipientState,
        ciphertext: preparedPayload.ciphertext,
        encryptionMeta: preparedPayload.encryptionMeta as
          | Prisma.InputJsonValue
          | undefined,
        contentType: this.resolveContentType(dto.message.contentType),
        clientMessageId: dto.message.clientMessageId,
        replyToId: dto.message.replyToId,
      });

    await this.chatDelivery.publishMessageCreated({
      conversationId: result.conversation.id,
      messageId: result.message.id,
      senderId,
      recipientUserIds: [dto.recipientUserId],
      shouldNotify,
    });

    return {
      conversationId: result.conversation.id,
      message: result.message,
      recipientState,
    };
  }

  /**
   * Creates a group chat with the caller as OWNER.
   *
   * Members who mutually follow the creator join ACTIVE immediately; everyone
   * else starts PENDING and must accept the invite first, same consent gate
   * as adding members to an existing group.
   */
  async createGroupChat(userId: string, dto: CreateGroupChatDto) {
    const memberIds = Array.from(new Set(dto.memberUserIds)).filter(
      (memberId) => memberId !== userId,
    );

    if (memberIds.length < 1) {
      throw new BadRequestException('Group chat requires at least one member');
    }

    const users = await this.chatRepository.findActiveUsersByIds(memberIds);

    if (users.length !== memberIds.length) {
      throw new BadRequestException('One or more group members are invalid');
    }

    const members = await this.resolveGroupMemberStates(userId, users);

    return this.chatRepository.createGroupConversation({
      creatorId: userId,
      title: dto.title,
      photoUrl: dto.photoUrl,
      members,
    });
  }

  async updateGroupChat(
    userId: string,
    conversationId: string,
    dto: UpdateGroupChatDto,
  ) {
    await this.assertCanManageGroup(userId, conversationId);

    return this.chatRepository.updateGroupConversation({
      conversationId,
      title: dto.title,
      photoUrl: dto.photoUrl,
    });
  }

  /**
   * Adds members to a group chat.
   *
   * Only OWNER and ADMIN participants can add members. A member who mutually
   * follows the adder joins ACTIVE immediately; everyone else start PENDING
   * and must accept the invite via the existing request accept/decline flow.
   */
  async addGroupMembers(
    userId: string,
    conversationId: string,
    dto: UpdateGroupMembersDto,
  ) {
    await this.assertCanManageGroup(userId, conversationId);

    const memberIds = Array.from(new Set(dto.userIds)).filter(
      (memberId) => memberId !== userId,
    );

    if (memberIds.length < 1) {
      throw new BadRequestException('At least one member is required');
    }

    const users = await this.chatRepository.findActiveUsersByIds(memberIds);

    if (users.length !== memberIds.length) {
      throw new BadRequestException('One or more group members are invalid');
    }

    const members = await this.resolveGroupMemberStates(userId, users);

    return this.chatRepository.addGroupMembers(conversationId, members);
  }

  /**
   * Removes members from a group chat.
   *
   * Removed members are marked DECLINED so message history can remain intact.
   */
  async removeGroupMembers(
    userId: string,
    conversationId: string,
    dto: UpdateGroupMembersDto,
  ) {
    await this.assertCanManageGroup(userId, conversationId);

    if (dto.userIds.includes(userId)) {
      throw new BadRequestException('Use leave group instead');
    }

    return this.chatRepository.removeGroupMembers(
      conversationId,
      Array.from(new Set(dto.userIds)),
    );
  }

  /**
   * Transfer group ownership to another active member.
   *
   * The current owner becomes an ADMIN instead of losing group access,
   * and can leave normally afterward.
   */
  async transferGroupOwnership(
    userId: string,
    conversationId: string,
    dto: TransferGroupOwnershipDto,
  ) {
    await this.assertIsGroupOwner(userId, conversationId);

    if (dto.newOwnerUserId === userId) {
      throw new BadRequestException('You already own this group');
    }

    const newOwner = await this.chatRepository.findParticipant(
      conversationId,
      dto.newOwnerUserId,
    );

    if (!newOwner || newOwner.state !== 'ACTIVE') {
      throw new BadRequestException('New owner must be an active group member');
    }

    return this.chatRepository.transferGroupOwnership(
      conversationId,
      userId,
      dto.newOwnerUserId,
    );
  }

  /**
   * Promote or demotes a group member between MEMBER and ADMIN.
   *
   * Only the owner can change roles. Use transferGroupOwnership to
   * change who owns the group instead.
   */
  async updateGroupMemberRole(
    userId: string,
    conversationId: string,
    targetUserId: string,
    dto: UpdateGroupMemberRoleDto,
  ) {
    await this.assertIsGroupOwner(userId, conversationId);

    if (targetUserId === userId) {
      throw new BadRequestException(
        'User transferGroupOwnership to change your own role',
      );
    }

    const target = await this.chatRepository.findParticipant(
      conversationId,
      targetUserId,
    );

    if (!target || target.state !== 'ACTIVE') {
      throw new NotFoundException('Group member not found');
    }

    if (target.role === 'OWNER') {
      throw new BadRequestException('Cannot change role of group owner');
    }

    return this.chatRepository.updateParticipantRole(
      conversationId,
      targetUserId,
      dto.role,
    );
  }

  /**
   * Lets a normal group member leave.
   *
   * Owners must transfer ownership before leaving so the group always has an owner.
   */
  async leaveGroup(userId: string, conversationId: string) {
    const conversation =
      await this.chatRepository.findConversationWithParticipants(
        conversationId,
      );

    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('Group conversation not found');
    }

    const participant = conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant || participant.state !== 'ACTIVE') {
      throw new ForbiddenException('You are not in this group');
    }

    if (participant.role === 'OWNER') {
      throw new BadRequestException(
        'Owner cannot leave before transferring ownership',
      );
    }

    return this.chatRepository.removeGroupMembers(conversationId, [userId]);
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

    const summaries = await this.toConversationSummaries(conversations, userId);

    return summaries.sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  /**
   * Gets unread counts for chat badges.
   *
   * This endpoint is intentionally lighter than the inbox list so clients can
   * refresh badge state without loading message previews.
   */
  async getUnreadSummary(userId: string) {
    const [unreadMessageCount, unreadConversationCount] = await Promise.all([
      this.chatRepository.countUnreadMessagesForUser(userId),
      this.chatRepository.countUnreadConversationsForUser(userId),
    ]);

    return {
      unreadMessageCount,
      unreadConversationCount,
    };
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

    return this.toConversationSummaries(conversations, userId);
  }

  /**
   * Lists archived conversations for a user.
   *
   * Archive/unarchive already move a conversation state
   * this just the missing way to see what's currently archived
   */
  async listArchivedConversations(userId: string) {
    const conversations = await this.chatRepository.findInboxConversations(
      userId,
      'ARCHIVED',
    );

    return this.toConversationSummaries(conversations, userId);
  }

  /**
   * Lists encrypted messages in a convo
   *
   * Business behavior:
   * - User must be allowed to read the convo
   * - Messages are loaded newest-first from the database for pagination
   * - The response reverses them back into chronological order for clients
   */
  async findMessages(
    userId: string,
    conversationId: string,
    query: QueryChatMessagesDto,
  ) {
    const participant = await this.assertReadableParticipant(
      conversationId,
      userId,
    );

    if (participant.state === 'PENDING') {
      const conversation =
        await this.chatRepository.findConversationType(conversationId);

      if (conversation?.type === 'GROUP') {
        throw new ForbiddenException(
          'Accept the group invite before viewing message history',
        );
      }
    }

    const limit = query.limit;

    const messages = await this.chatRepository.findMessages({
      conversationId,
      beforeMessageId: query.beforeMessageId,
      limit,
    });
    const nextBeforeMessageId = messages.at(-1)?.id ?? null;

    const senderIds = Array.from(
      new Set(
        messages
          .map((message) => message.senderId)
          .filter((senderId) => senderId !== userId),
      ),
    );

    const blockedUserIds = await this.chatRepository.findBlockedUserIds(
      userId,
      senderIds,
    );

    return {
      items: messages.reverse(),
      meta: {
        limit,
        nextBeforeMessageId,
        blockedSenderUserIds: Array.from(blockedUserIds),
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
   * Only the pending recipient can accept. After acceptance, the participant is
   * moved into ACTIVE state and future messages can behave like normal inbox messages.
   */
  async acceptRequest(userId: string, conversationId: string) {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (!participant || participant.deletedAt) {
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

    if (!participant || participant.deletedAt) {
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
   * Blocks another user globally for chat.
   *
   * Global blocks stop both new direct conversations and messages in existing
   * direct conversations between these users.
   */
  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const blockedUser = await this.chatRepository.findUserById(blockedId);

    if (!blockedUser || blockedUser.status !== 'ACTIVE') {
      throw new NotFoundException('User not found');
    }

    return this.chatRepository.blockUser(blockerId, blockedId);
  }

  /**
   * Removes the caller's global chat block for another user.
   *
   * This only removes the caller's block row; if the other user blocked back,
   * messaging still stays blocked by the send-time check.
   */
  async unblockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot unblock yourself');
    }

    const result = await this.chatRepository.unblockUser(blockerId, blockedId);

    return {
      unblockedCount: result.count,
    };
  }

  /**
   * Sets notification level for a conversation, with optional mute expiry.
   */
  async setNotificationLevel(
    userId: string,
    conversationId: string,
    notificationLevel: 'ALL' | 'NOTHING',
    mutedUntil?: string,
  ) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantNotificationLevel(
      conversationId,
      userId,
      notificationLevel,
      notificationLevel === 'NOTHING' && mutedUntil
        ? new Date(mutedUntil)
        : null,
    );
  }

  /**
   * Archives a conversation for the current user.
   *
   * This hides the convo from the normal ACTIVE inbox but keeps all encrypted
   * messages and receipts stored.
   */
  async archiveConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantArchivedState(
      conversationId,
      userId,
      true,
    );
  }

  /**
   * Unarchives a conversation for the current user.
   *
   * This moves the participant back to ACTIVE so the convo appears in the normal
   * inbox again.
   */
  async unarchiveConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantArchivedState(
      conversationId,
      userId,
      false,
    );
  }

  /**
   * Deletes a conversation for the current user only.
   *
   * "Delete for me": any participant can delete any conversation they're in,
   * regardless of state (including BLOCKED/DECLINED) — this intentionally
   * does not reuse assertReadableParticipant, which would block those states.
   * Does not touch the other participant's copy or the underlying messages.
   */
  async deleteConversation(userId: string, conversationId: string) {
    const participant = await this.chatRepository.findParticipant(
      conversationId,
      userId,
    );

    if (!participant) {
      throw new NotFoundException('Conversation not found');
    }

    await this.chatRepository.softDeleteConversationForParticipant(
      conversationId,
      userId,
    );

    return {
      message: 'Conversation deleted successfully',
    };
  }

  /**
   * Pins a conversation for the current user.
   *
   * Pinning is stored on ChatParticipant because it is personal inbox state.
   */
  async pinConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantPinnedAt(
      conversationId,
      userId,
      new Date(),
    );
  }

  /**
   * Unpins a conversation for the current user.
   *
   * Clearing pinnedAt returns the conversation to normal inbox sorting.
   */
  async unpinConversation(userId: string, conversationId: string) {
    await this.assertReadableParticipant(conversationId, userId);

    return this.chatRepository.updateParticipantPinnedAt(
      conversationId,
      userId,
      null,
    );
  }

  /**
   * Marks messages as delivered to the current user's device.
   *
   * This supports offline users: messages can be SENT in the database before
   * the recipient comes online and acknowledge delivery.
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

    await this.assertCanManageGameEmotes(userId, gameId);

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
   * Adds or updates the current user's reaction on a message.
   *
   * Business behavior:
   * - User must be able to read the message's convo.
   * - Deleted messages cannot be reacted to.
   * - One user gets one reaction per message; another reaction replaces it.
   */
  async reactToMessage(
    userId: string,
    messageId: string,
    dto: ReactToMessageDto,
  ) {
    await this.assertCanInteractWithMessage(userId, messageId);

    const emoji = dto.emoji?.trim();
    const emoteId = dto.emoteId?.trim();

    if (!emoji && !emoteId) {
      throw new BadRequestException('Reaction requires emoji or emoteId');
    }

    if (emoji && emoteId) {
      throw new BadRequestException('Reaction can only use emoji or emoteId');
    }

    if (emoji) {
      return this.chatRepository.upsertMessageReaction({
        messageId,
        userId,
        emoji,
        emoteId: null,
      });
    }

    const customEmoteId = emoteId as string;

    await this.assertCanUseEmote(userId, customEmoteId);

    return this.chatRepository.upsertMessageReaction({
      messageId,
      userId,
      emoji: null,
      emoteId: customEmoteId,
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
      encryptionMeta: dto.encryptionMeta as Prisma.InputJsonValue | undefined,
      contentType: dto.contentType,
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
    const conversation =
      await this.chatRepository.findConversationWithParticipants(
        conversationId,
      );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const deliverableParticipants =
      conversation.type === 'GROUP'
        ? participants.filter((participant) =>
            ['ACTIVE', 'ARCHIVED'].includes(participant.state),
          )
        : participants;

    if (conversation.type === 'DIRECT') {
      const recipient = deliverableParticipants.find(
        (participant) => participant.userId !== senderId,
      );

      if (recipient) {
        await this.assertSenderHasNotBlockedRecipient(
          senderId,
          recipient.userId,
        );
      }
    }

    const blockedOrDeclinedRecipient =
      conversation.type === 'DIRECT'
        ? participants.find(
            (participant) =>
              participant.userId !== senderId &&
              ['BLOCKED', 'DECLINED'].includes(participant.state),
          )
        : null;

    if (blockedOrDeclinedRecipient) {
      throw new ForbiddenException('Recipient is not accepting messages');
    }

    await this.assertValidReplyTarget(conversationId, dto.message.replyToId);

    if (senderParticipant.deletedAt) {
      await this.chatRepository.restoreDeletedParticipants(
        conversationId,
        senderId,
      );
    }

    const payload =
      preparedPayload ??
      (await this.messageEncryption.preparePayload(dto.message));

    const message = await this.chatRepository.createMessage({
      conversationId,
      senderId,
      participantUserIds: deliverableParticipants.map(
        (participant) => participant.userId,
      ),
      ciphertext: payload.ciphertext,
      encryptionMeta: payload.encryptionMeta as
        | Prisma.InputJsonValue
        | undefined,
      contentType: this.resolveContentType(dto.message.contentType),
      clientMessageId: dto.message.clientMessageId,
      replyToId: dto.message.replyToId,
    });

    const recipientParticipants = deliverableParticipants.filter(
      (participant) => participant.userId !== senderId,
    );

    const notifiableFlags = await Promise.all(
      recipientParticipants.map((participant) =>
        this.isRecipientNotifiable(conversation.type, senderId, participant),
      ),
    );

    const notifiableRecipientIds = recipientParticipants
      .filter((_, index) => notifiableFlags[index])
      .map((participant) => participant.userId);

    const silentRecipientIds = recipientParticipants
      .filter((_, index) => !notifiableFlags[index])
      .map((participant) => participant.userId);

    if (notifiableRecipientIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        conversationId,
        messageId: message.id,
        senderId,
        recipientUserIds: notifiableRecipientIds,
        shouldNotify: true,
      });
    }

    if (silentRecipientIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        conversationId,
        messageId: message.id,
        senderId,
        recipientUserIds: silentRecipientIds,
        shouldNotify: false,
      });
    }

    return {
      conversationId,
      message,
      duplicate: false,
    };
  }

  /**
   * Resolves each candidate group member to ACTIVE or PENDING.
   *
   * Shared by createGroupChat and addGroupMembers — applies the same
   * message-request gate as createDirectMessage, per member.
   */
  private async resolveGroupMemberStates(
    userId: string,
    members: Array<{
      id: string;
      messageRequestSetting: MessageRequestSetting;
    }>,
  ) {
    return Promise.all(
      members.map(async (member) => {
        const areMutualFollowers = await this.assertMessageRequestAllowed(
          userId,
          member,
        );

        return {
          userId: member.id,
          state: areMutualFollowers
            ? ('ACTIVE' as const)
            : ('PENDING' as const),
        };
      }),
    );
  }

  /**
   * Verifies the caller can manage a group conversation.
   *
   * Group management is scoped to active OWNER and ADMIN participants.
   */
  private async assertCanManageGroup(userId: string, conversationId: string) {
    const conversation =
      await this.chatRepository.findConversationWithParticipants(
        conversationId,
      );

    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('Group conversation not found');
    }

    const participant = conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant || participant.state !== 'ACTIVE') {
      throw new ForbiddenException('You are not in this group');
    }

    if (!['OWNER', 'ADMIN'].includes(participant.role)) {
      throw new ForbiddenException('Group admin permission required');
    }

    return participant;
  }

  /**
   * Verifies the caller is the group's OWNER specifically.
   *
   * Ownership transfer and role changes are stricter than general group
   * management (OWNER + ADMIN), only the owner can do these two things.
   */
  private async assertIsGroupOwner(userId: string, conversationId: string) {
    const participant = await this.assertCanManageGroup(userId, conversationId);

    if (participant.role !== 'OWNER') {
      throw new ForbiddenException('Only the group owner can do this');
    }

    return participant;
  }

  /**
   * Verifies the user can use an emote.
   *
   * Global emotes are open to everyone, while game emotes require membership in
   * the owning game community.
   */
  private async assertCanUseEmote(userId: string, emoteId: string) {
    const emote = await this.chatRepository.findUsableChatEmote(
      emoteId,
      userId,
    );

    if (!emote) {
      throw new ForbiddenException('You cannot use this emote');
    }

    return emote;
  }

  /**
   * Verifies the caller can create custom emotes for a game.
   *
   * App admins can manage every game. Game moderators can manage only their
   * assigned game.
   */
  private async assertCanManageGameEmotes(userId: string, gameId: string) {
    const user = await this.chatRepository.findUserById(userId);

    if (user?.role === UserRole.ADMIN) {
      return;
    }

    const isModerator = await this.gameModeratorsService.isModerator(
      gameId,
      userId,
    );

    if (!isModerator) {
      throw new ForbiddenException('You cannot manage emotes for this game');
    }
  }

  /**
   * Verifies the sender has not blocked the recipient.
   *
   * Block is now asymmetric: the blocker cannot send to the blocked users,
   * but the blocked user can still send to the blocker (silently, with no notification)
   */
  private async assertSenderHasNotBlockedRecipient(
    senderId: string,
    recipientId: string,
  ) {
    const block = await this.chatRepository.findUserBlock(
      senderId,
      recipientId,
    );

    if (block) {
      throw new ForbiddenException('You have blocked this user');
    }
  }

  /**
   * Enforces a target user's messageRequestSetting against a would-be sender.
   *
   * NO_ONE always rejects. FOLLOWERS rejects unless the target follows the
   * actor back. Returns whether the two mutually follow each other, since
   * callers use that to decide ACTIVE vs PENDING state.
   */
  private async assertMessageRequestAllowed(
    actorId: string,
    target: { id: string; messageRequestSetting: MessageRequestSetting },
  ) {
    if (target.messageRequestSetting === 'NO_ONE') {
      throw new ForbiddenException(
        `User ${target.id} is not accepting new messages`,
      );
    }

    const [actorFollowsTargetResult, targetFollowsActorResult] =
      await Promise.all([
        this.followsService.isFollowing(actorId, target.id),
        this.followsService.isFollowing(target.id, actorId),
      ]);
    const actorFollowsTarget = actorFollowsTargetResult.following;
    const targetFollowsActor = targetFollowsActorResult.following;

    if (target.messageRequestSetting === 'FOLLOWERS' && !targetFollowsActor) {
      throw new ForbiddenException(
        `User ${target.id} only accepts messages from people they follow`,
      );
    }

    return actorFollowsTarget && targetFollowsActor;
  }

  /**
   * Decides whether one recipient should be notified about a new message.
   *
   * Checked per recipient so one muted/archived/blocking group member can't
   * suppress notifications for everyone else. Direct conversations
   * additionally suppress notification for a recipient who has blocked the
   * sender: the message still sends and stores normally, the recipient just
   * never finds out about it unless they open the convo.
   */
  private async isRecipientNotifiable(
    conversationType: string,
    senderId: string,
    recipient: {
      userId: string;
      state: string;
      notificationLevel: 'ALL' | 'NOTHING';
      mutedUntil: Date | null;
    },
  ) {
    const isMuted =
      recipient.notificationLevel === 'NOTHING' &&
      (!recipient.mutedUntil || recipient.mutedUntil > new Date());

    if (recipient.state !== 'ACTIVE' || isMuted) {
      return false;
    }

    if (conversationType !== 'DIRECT') {
      return true;
    }

    const recipientBlockedSender = await this.chatRepository.findUserBlock(
      recipient.userId,
      senderId,
    );

    return !recipientBlockedSender;
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

    if (!participant || participant.deletedAt) {
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
   * Reactions are message-level action, but permission is based on whether the
   * user can read the message's parent convo
   */
  private async assertCanInteractWithMessage(
    userId: string,
    messageId: string,
  ) {
    const message =
      await this.chatRepository.findMessageWithParticipants(messageId);

    if (!message || message.status !== 'SENT') {
      throw new NotFoundException('Message not found');
    }

    const participant = message.conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (
      !participant ||
      participant.deletedAt ||
      !this.canReadState(participant.state)
    ) {
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

    if (
      !participant ||
      participant.deletedAt ||
      !this.canReadState(participant.state)
    ) {
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
   * Resolves the stored content type for a message payload.
   *
   * Single source of truth for the TEXT default so createDirectMessage and
   * sendMessageToExistingConversation can't drift from each other.
   */
  private resolveContentType(contentType?: ChatMessageContentType) {
    return contentType ?? ChatMessageContentType.TEXT;
  }

  /**
   * One block list query for the whole batch, not one per convo.
   *
   * collects every other participant across all convos first, one lookup
   * toConversationSummary just takes the result now, no query of its own
   */
  private async toConversationSummaries(
    conversations: Awaited<
      ReturnType<ChatRepository['findInboxConversations']>
    >,
    userId: string,
  ) {
    const otherParticipantIds = Array.from(
      new Set(
        conversations.flatMap((conversation) =>
          conversation.participants
            .map((participant) => participant.userId)
            .filter((participantUserId) => participantUserId !== userId),
        ),
      ),
    );

    const blockedUserIds = await this.chatRepository.findBlockedUserIds(
      userId,
      otherParticipantIds,
    );

    return Promise.all(
      conversations.map((conversation) =>
        this.toConversationSummary(conversation, userId, blockedUserIds),
      ),
    );
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
    blockedUserIds: Set<string>,
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
      pinnedAt: currentParticipant?.pinnedAt ?? null,
      participants: conversation.participants.map((participant) =>
        this.buildParticipantSummary(participant, userId, blockedUserIds),
      ),
      lastMessage,
      unreadCount,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  }

  /**
   * Shapes one participant row for a conversation summary.
   *
   * Own method so masking and block-flag logic aren't buried inside
   * the bigger toConversationSummary assembly.
   */
  private buildParticipantSummary(
    participant: Awaited<
      ReturnType<ChatRepository['findInboxConversations']>
    >[number]['participants'][number],
    viewerId: string,
    blockedUserIds: Set<string>,
  ) {
    return {
      userId: participant.userId,
      role: participant.role,
      state: this.maskParticipantStateForViewer(participant, viewerId),
      pinnedAt: participant.pinnedAt,
      notificationLevel: participant.notificationLevel,
      mutedUntil: participant.mutedUntil,
      user: participant.user,
      isBlockedByMe: blockedUserIds.has(participant.userId),
    };
  }

  /**
   * Masks BLOCKED state from other participants.
   *
   * Blocked is a private per-user action, showing it leaks "this person
   * blocked me". Same issue as hasBlockedMe, just for per convo block now.
   */
  private maskParticipantStateForViewer(
    participant: { userId: string; state: string },
    viewerId: string,
  ) {
    if (participant.userId === viewerId) {
      return participant.state;
    }

    return participant.state === 'BLOCKED' ? 'ACTIVE' : participant.state;
  }
}
