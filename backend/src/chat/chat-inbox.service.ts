import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { BlocksService } from '../blocks/blocks.service';
import { ChatMembershipService } from './membership/chat-membership.service';
import { ChatHistoryFetchRateLimiterService } from './chat-history-fetch-rate-limiter.service';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';

/**
 * Inbox listing, per-conversation settings, and read/delivery receipts.
 * Pulled out of the former monolithic ChatService as its own concern -
 * everything here reads or toggles per-participant state on a conversation
 * a user is already in, distinct from sending messages or managing group
 * membership.
 */
@Injectable()
export class ChatInboxService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    private readonly blocksService: BlocksService,
    private readonly chatMembershipService: ChatMembershipService,
    private readonly historyFetchRateLimiter: ChatHistoryFetchRateLimiterService,
  ) {}

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
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

    const limit = query.limit;

    if (query.beforeMessageId) {
      this.historyFetchRateLimiter.assertNotRateLimited(userId, conversationId);

      const cursorMessage =
        await this.chatRepository.findSentMessageInConversation(
          query.beforeMessageId,
          conversationId,
        );
      if (!cursorMessage) {
        throw new BadRequestException('Invalid pagination cursor');
      }
    }

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

    const blockedUserIds = await this.blocksService.getBlockedIdsAmong(
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
   * Accepts a pending stranger convo.
   *
   * Only the pending recipient can accept. After acceptance, the participant is
   * moved into ACTIVE state and future messages can behave like normal inbox messages -
   * or into JOINING first when the conversation is MLS-encrypted, until a member's
   * Commit adds their devices (see ChatMembershipService).
   */
  async acceptRequest(userId: string, conversationId: string) {
    await this.assertHasVisibleParticipant(conversationId, userId);

    await this.chatMembershipService.acceptInvite(conversationId, userId);

    return this.chatRepository.findParticipant(conversationId, userId);
  }

  /**
   * Declines a pending convo.
   *
   * Declining keeps the conversation record for audit/history behavior, but
   * marks the participant as DECLINED so future sends are rejected.
   */
  async declineRequest(userId: string, conversationId: string) {
    await this.assertHasVisibleParticipant(conversationId, userId);

    await this.chatMembershipService.declineInvite(conversationId, userId);

    return this.chatRepository.findParticipant(conversationId, userId);
  }

  private async assertHasVisibleParticipant(
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
  }

  /**
   * Blocks a convo for the current user.
   *
   * Blocking is stored on the participant row because chat safety state is
   * user-specific, not global to the convo.
   */
  async blockConversation(userId: string, conversationId: string) {
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

    return this.chatRepository.updateParticipantState(
      conversationId,
      userId,
      'BLOCKED',
    );
  }

  /**
   * Blocks another user globally for chat.
   *
   * One-directional: stops the caller's own new/existing direct messages to
   * this user. The blocked user can still message the caller back, silently.
   */
  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const blockedUser = await this.chatRepository.findUserById(blockedId);

    if (!blockedUser || blockedUser.status !== 'ACTIVE') {
      throw new NotFoundException('User not found');
    }

    return this.blocksService.block(blockerId, blockedId);
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

    const unblockedCount = await this.blocksService.unblock(
      blockerId,
      blockedId,
    );

    return {
      unblockedCount,
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
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

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
    await this.chatAccessService.assertParticipantState(
      conversationId,
      userId,
      'ACTIVE',
      'Only active conversations can be archived',
    );

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
    await this.chatAccessService.assertParticipantState(
      conversationId,
      userId,
      'ARCHIVED',
      'Only archived conversations can be unarchived',
    );

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
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

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
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

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
    await this.chatAccessService.assertReadableParticipant(
      conversationId,
      userId,
    );

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

    const blockedUserIds = await this.blocksService.getBlockedIdsAmong(
      userId,
      otherParticipantIds,
    );

    const unreadCounts =
      await this.chatRepository.countUnreadMessagesForConversations(
        conversations.map((conversation) => conversation.id),
        userId,
      );
    const unreadCountsByConversationId = new Map(
      unreadCounts.map((row) => [row.conversationId, row._count._all]),
    );

    return conversations.map((conversation) =>
      this.toConversationSummary(
        conversation,
        userId,
        blockedUserIds,
        unreadCountsByConversationId,
      ),
    );
  }

  /**
   * Converts a convo record into an inbox/request list item.
   *
   * The summary includes participant info, latest encrypted message payload,
   * unread count, and timestamps needed by the frontend inbox UI.
   */
  private toConversationSummary(
    conversation: Awaited<
      ReturnType<ChatRepository['findInboxConversations']>
    >[number],
    userId: string,
    blockedUserIds: Set<string>,
    unreadCountsByConversationId: Map<string, number>,
  ) {
    const currentParticipant = conversation.participants.find(
      (participant) => participant.userId === userId,
    );
    const lastMessage = conversation.messages[0] ?? null;

    const unreadCount = unreadCountsByConversationId.get(conversation.id) ?? 0;

    return {
      id: conversation.id,
      type: conversation.type,
      status: conversation.status,
      title: conversation.title,
      photoUrl: conversation.photoUrl,
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
    const isViewer = participant.userId === viewerId;

    return {
      userId: participant.userId,
      role: participant.role,
      state: this.maskParticipantStateForViewer(participant, viewerId),
      pinnedAt: isViewer ? participant.pinnedAt : null,
      notificationLevel: isViewer ? participant.notificationLevel : null,
      mutedUntil: isViewer ? participant.mutedUntil : null,
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
