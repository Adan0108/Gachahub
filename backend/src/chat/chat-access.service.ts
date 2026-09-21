import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatParticipantState,
  MessageRequestSetting,
  UserRole,
} from '../generated/prisma/client';
import { MembershipChangePendingException } from '../common/exceptions/membership-change-pending.exception';
import { ChatRepository } from './chat.repository';
import { FollowsService } from '../follows/follows.service';
import { BlocksService } from '../blocks/blocks.service';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';

/**
 * Permission and eligibility checks shared across chat's other services -
 * "can this actor do X" guards and booleans, no business orchestration of
 * its own. Pulled out of the former monolithic ChatService because these
 * checks are genuinely cross-cutting: assertMessageRequestAllowed backs
 * both direct-message send and group member resolution, assertReadableParticipant
 * backs half of ChatInboxService, getDeliverableRecipientIds backs every
 * ChatMessageActionsService mutation, and so on.
 */
@Injectable()
export class ChatAccessService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly followsService: FollowsService,
    private readonly blocksService: BlocksService,
    private readonly gameModeratorsService: GameModeratorsService,
  ) {}

  /**
   * Verifies the user can read a conversation.
   *
   * PENDING is readable so users can preview stranger requests. BLOCKED and
   * DECLINED are not readable through normal chat endpoints.
   */
  async assertReadableParticipant(conversationId: string, userId: string) {
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
   * Verifies the user's participant state matches exactly, not just readable.
   *
   * Used by actions like archive/unarchive that need one specific starting
   * state instead of any readable one.
   */
  async assertParticipantState(
    conversationId: string,
    userId: string,
    requiredState: ChatParticipantState,
    errorMessage: string,
  ) {
    const participant = await this.assertReadableParticipant(
      conversationId,
      userId,
    );

    if (participant.state !== requiredState) {
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Verifies the user can interact with a specific message.
   *
   * Reactions are message-level action, but permission is based on whether the
   * user can read the message's parent convo
   */
  async assertCanInteractWithMessage(userId: string, messageId: string) {
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
  async assertCanModifyOwnMessage(userId: string, messageId: string) {
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
   * A pending request can be previewed but shouldn't leak a live presence
   * signal before either side has accepted.
   */
  canShowTypingState(state: ChatParticipantState) {
    return this.canReadState(state) && state !== 'PENDING';
  }

  /**
   * Blocks sending new encrypted content into a group that still has a member
   * being removed (state LEAVING): their devices remain in the MLS group until
   * a Remove Commit lands, so anything encrypted now would still be readable
   * to them. Callers run this after their own access checks, so it never tells
   * an outsider anything about the conversation.
   */
  assertNoMembershipChangePending(
    participants: ReadonlyArray<{ state: ChatParticipantState }>,
  ) {
    if (participants.some((participant) => participant.state === 'LEAVING')) {
      throw new MembershipChangePendingException();
    }
  }

  /**
   * Same state rule as the private isDeliveryEligible, minus the deletedAt
   * check. Lets callers decide for themselves whether a deleted-for-me
   * participant still counts.
   */
  isStateDeliveryEligible(conversationType: string, state: string): boolean {
    return conversationType === 'GROUP'
      ? ['ACTIVE', 'ARCHIVED'].includes(state)
      : true;
  }

  /**
   * Lists who should receive a real-time event for a message action.
   *
   * Same eligibility rule as message delivery, minus the actor themselves.
   */
  getDeliverableRecipientIds(
    conversation: {
      type: string;
      participants: Array<{
        userId: string;
        state: string;
        deletedAt: Date | null;
      }>;
    },
    actorId: string,
  ): string[] {
    return conversation.participants
      .filter(
        (participant) =>
          participant.userId !== actorId &&
          this.isDeliveryEligible(conversation.type, participant),
      )
      .map((participant) => participant.userId);
  }

  /**
   * Verifies the sender has not blocked the recipient.
   *
   * Block is now asymmetric: the blocker cannot send to the blocked users,
   * but the blocked user can still send to the blocker (silently, with no notification)
   */
  async assertSenderHasNotBlockedRecipient(
    senderId: string,
    recipientId: string,
  ) {
    const isBlocked = await this.blocksService.isBlocked(senderId, recipientId);

    if (isBlocked) {
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
  async assertMessageRequestAllowed(
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
   * suppress notifications for everyone else. A recipient who has blocked
   * the sender never finds out about it unless they open the convo -
   * checked regardless of conversation type, direct or group.
   */
  async isRecipientNotifiable(
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

    const recipientBlockedSender = await this.blocksService.isBlocked(
      recipient.userId,
      senderId,
    );

    return !recipientBlockedSender;
  }

  /**
   * Verifies a reply target message belongs to this conversation.
   *
   * No-op when replyToId isn't set, replies are optional.
   */
  async assertValidReplyTarget(conversationId: string, replyToId?: string) {
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
   * Verifies the caller can manage a group conversation.
   *
   * Group management is scoped to active OWNER and ADMIN participants.
   */
  async assertCanManageGroup(userId: string, conversationId: string) {
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
  async assertIsGroupOwner(userId: string, conversationId: string) {
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
  async assertCanUseEmote(userId: string, emoteId: string) {
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
  async assertCanManageGameEmotes(userId: string, gameId: string) {
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
   * Central list of participant states that can read messages.
   *
   * Keep this helper small so future states, such as MUTED or LIMITED, can be
   * added without hunting through every chat operation.
   */
  private canReadState(state: ChatParticipantState) {
    return ['ACTIVE', 'PENDING', 'ARCHIVED'].includes(state);
  }

  /**
   * Decides whether one participant should receive a real-time delivery.
   *
   * Deleted-for-me participants never qualify; groups additionally require
   * ACTIVE or ARCHIVED state.
   */
  private isDeliveryEligible(
    conversationType: string,
    participant: { state: string; deletedAt: Date | null },
  ): boolean {
    if (participant.deletedAt) {
      return false;
    }

    return this.isStateDeliveryEligible(conversationType, participant.state);
  }
}
