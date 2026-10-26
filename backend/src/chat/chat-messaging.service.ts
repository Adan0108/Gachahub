import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatConversationType,
  ChatMessageContentType,
  ChatParticipantState,
  Prisma,
} from '../generated/prisma/client';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { PrismaService } from '../prisma/prisma.service';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { ChatMembershipService } from './membership/chat-membership.service';
import { isUniqueViolationOn } from './prisma-unique-violation';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMediaReferenceDto } from './dto/chat-media-reference.dto';
import { MediaService } from '../media/media.service';
import { MAX_OPAQUE_BLOBS_PER_MESSAGE } from '../media/opaque-blob';
import type { ChatMessageMediaInput } from './chat.repository';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

type RecipientCandidate = {
  userId: string;
  state: ChatParticipantState;
  notificationLevel: 'ALL' | 'NOTHING';
  mutedUntil: Date | null;
};

/** Everything about the participants that decides who a message goes to; equal keys give equal recipients. */
function participantsKey(participants: RecipientCandidate[]) {
  return participants
    .map(
      (p) =>
        `${p.userId}:${p.state}:${p.notificationLevel}:${p.mutedUntil?.getTime() ?? ''}`,
    )
    .sort()
    .join(',');
}

/** Sends encrypted messages: first direct message and follow-ups, with idempotency, eligibility and delivery fan-out. */
@Injectable()
export class ChatMessagingService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    private readonly mediaService: MediaService,
    @Inject(MESSAGE_ENCRYPTION_PORT)
    private readonly messageEncryption: MessageEncryptionPort,
    @Inject(CHAT_DELIVERY_PORT)
    private readonly chatDelivery: ChatDeliveryPort,
    private readonly chatMessageRateLimiter: ChatMessageRateLimiterService,
    private readonly chatDevicesService: ChatDevicesService,
    private readonly eventPublisher: EventPublisherPort,
    private readonly prisma: PrismaService,
    private readonly chatMembershipService: ChatMembershipService,
  ) {}

  /** Creates or reuses a direct convo and sends a first encrypted message; clientMessageId dedupes retries, needs an active linked device. New convos start PENDING unless the users mutually follow (then ACTIVE). */
  async createDirectMessage(
    senderId: string,
    sessionId: string,
    dto: CreateDirectMessageDto,
  ) {
    await this.chatDevicesService.assertSessionLinkedToActiveDevice(
      senderId,
      sessionId,
    );
    this.chatMessageRateLimiter.assertNotRateLimited(senderId);

    if (senderId === dto.recipientUserId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const [userIdA, userIdB] = this.normalizeDirectPair(
      senderId,
      dto.recipientUserId,
    );

    // Independent reads run concurrently; the block check stays sequential so error precedence is unchanged.
    const [recipient, existingPair, existingMessage] = await Promise.all([
      this.chatRepository.findUserById(dto.recipientUserId),
      this.chatRepository.findDirectPair(userIdA, userIdB),
      this.chatRepository.findMessageBySenderClientMessageId(
        senderId,
        dto.message.clientMessageId,
      ),
    ]);

    if (!recipient || recipient.status !== 'ACTIVE') {
      throw new NotFoundException('Recipient not found');
    }

    await this.chatAccessService.assertSenderHasNotBlockedRecipient(
      senderId,
      dto.recipientUserId,
    );

    if (existingMessage) {
      if (existingMessage.conversationId !== existingPair?.conversation.id) {
        throw new ConflictException(
          'This clientMessageId was already used with a different recipient',
        );
      }

      return {
        conversationId: existingMessage.conversationId,
        message: existingMessage,
        duplicate: true,
      };
    }

    // "Start a chat" with someone you already have a visible chat with opens that chat: another
    // "conversation started" marker would land in it, and clients that only page the inbox cannot
    // always tell the chat exists. Hidden or archived on your side, the marker still brings it back.
    if (existingPair && dto.message.contentType === 'SYSTEM') {
      const mine = existingPair.conversation.participants.find(
        (participant) => participant.userId === senderId,
      );
      if (mine?.state === 'ACTIVE' && !mine.deletedAt) {
        const theirs = existingPair.conversation.participants.find(
          (participant) => participant.userId === dto.recipientUserId,
        );
        return {
          conversationId: existingPair.conversation.id,
          message: null,
          recipientState: theirs?.state ?? null,
        };
      }

      // Starting the chat yourself after declining (or while the decline is still being applied)
      // is a change of mind: they are let back in, and rejoin like anyone who accepts.
      if (mine?.state === 'DECLINED' || mine?.state === 'LEAVING') {
        await this.chatMembershipService.reopenDirect(
          existingPair.conversation.id,
          senderId,
        );
        const theirs = existingPair.conversation.participants.find(
          (participant) => participant.userId === dto.recipientUserId,
        );
        return {
          conversationId: existingPair.conversation.id,
          message: null,
          recipientState: theirs?.state ?? null,
        };
      }
    }

    // Only known when the direct pair already exists; a new conversation has no id to check group_id against.
    const preparedPayload = await this.messageEncryption.preparePayload(
      dto.message,
      existingPair?.conversation.id,
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

    const areMutualFollowers =
      await this.chatAccessService.assertMessageRequestAllowed(
        senderId,
        recipient,
      );

    const recipientState = areMutualFollowers ? 'ACTIVE' : 'PENDING';

    const shouldNotify = await this.chatAccessService.isRecipientNotifiable(
      senderId,
      {
        userId: dto.recipientUserId,
        state: recipientState,
        notificationLevel: 'ALL',
        mutedUntil: null,
      },
    );

    const media = await this.resolveChatMessageMedia(
      senderId,
      dto.message.media,
    );

    let result: Awaited<
      ReturnType<ChatRepository['createDirectConversationWithMessage']>
    >;

    try {
      result = await this.prisma.$transaction(async (tx) => {
        const created =
          await this.chatRepository.createDirectConversationWithMessage(tx, {
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
            media,
          });

        await this.eventPublisher.publish(
          {
            type: 'chat.message.sent',
            aggregateId: created.conversation.id,
            payload: {
              messageId: created.message.id,
              conversationId: created.conversation.id,
              senderId,
              // A brand-new conversation's first message can never be a reply (checked above).
              replyToMessageId: null,
              replyToSenderId: null,
              recipientUserIds: shouldNotify ? [dto.recipientUserId] : [],
            },
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      const isPairConflict = this.isDuplicateDirectPairConflict(error);
      const isMessageConflict = this.isDuplicateMessageConflict(error);

      if (!isPairConflict && !isMessageConflict) {
        throw error;
      }

      const racedPair = await this.chatRepository.findDirectPair(
        userIdA,
        userIdB,
      );

      if (isPairConflict) {
        if (!racedPair) {
          throw error;
        }

        return this.sendMessageToExistingConversation(
          senderId,
          racedPair.conversation.id,
          {
            message: dto.message,
          },
          preparedPayload,
        );
      }

      return this.recoverDuplicateMessage(
        senderId,
        racedPair?.conversation.id,
        dto.message.clientMessageId,
      );
    }

    await this.chatDelivery.publishMessageCreated({
      conversationId: result.conversation.id,
      messageId: result.message.id,
      senderId,
      recipientUserIds: [dto.recipientUserId],
      shouldNotify,
      ciphertext: result.message.ciphertext,
      encryptionMeta: result.message.encryptionMeta,
      contentType: result.message.contentType,
      createdAt: result.message.createdAt,
      clientMessageId: result.message.clientMessageId,
      replyToId: result.message.replyToId,
      media: result.message.media,
    });

    return {
      conversationId: result.conversation.id,
      message: result.message,
      recipientState,
    };
  }

  /** Sends an encrypted message to an existing convo; requires an active linked device, since revoked-device eviction lags the Remove Commit. */
  async sendMessage(
    senderId: string,
    sessionId: string,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    await this.chatDevicesService.assertSessionLinkedToActiveDevice(
      senderId,
      sessionId,
    );
    this.chatMessageRateLimiter.assertNotRateLimited(senderId);

    const preparedPayload = await this.messageEncryption.preparePayload(
      dto.message,
      conversationId,
    );

    return this.sendMessageToExistingConversation(
      senderId,
      conversationId,
      dto,
      preparedPayload,
    );
  }

  /** Shared send path for first and follow-up messages: dedupe, participant state, block/decline checks, creation, delivery hook. */
  private async sendMessageToExistingConversation(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
    preparedPayload?: {
      ciphertext: string;
      encryptionMeta?: Record<string, unknown>;
    },
  ) {
    // Independent reads run concurrently to save a DB round trip.
    const [existingMessage, conversation] = await Promise.all([
      this.chatRepository.findMessageBySenderClientMessageId(
        senderId,
        dto.message.clientMessageId,
      ),
      this.chatRepository.findConversationWithParticipants(conversationId),
    ]);

    if (existingMessage) {
      if (existingMessage.conversationId !== conversationId) {
        throw new ConflictException(
          'This clientMessageId was already used in a different conversation',
        );
      }

      return {
        conversationId: existingMessage.conversationId,
        message: existingMessage,
        duplicate: true,
      };
    }

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.chatAccessService.assertSenderCanPost(conversation, senderId);

    const participants = conversation.participants;

    const replyTarget = await this.chatAccessService.assertValidReplyTarget(
      conversationId,
      dto.message.replyToId,
    );

    let recipients = await this.resolveRecipients(
      conversation.type,
      senderId,
      participants,
      dto.message.mentionUserIds,
    );

    const payload =
      preparedPayload ??
      (await this.messageEncryption.preparePayload(
        dto.message,
        conversationId,
      ));

    const media = await this.resolveChatMessageMedia(
      senderId,
      dto.message.media,
    );

    let message: Awaited<ReturnType<ChatRepository['createMessage']>>;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        // Authoritative re-check under the same lock a membership change takes:
        // the participant list read above, outside this transaction, can be
        // stale by the time this insert runs.
        const freshParticipants =
          await this.chatRepository.lockAndFindParticipants(tx, conversationId);
        const freshSender = freshParticipants.find(
          (participant) => participant.userId === senderId,
        );

        if (!freshSender || freshSender.state !== 'ACTIVE') {
          throw new ForbiddenException('You cannot send messages here');
        }

        this.chatAccessService.assertNoMembershipChangePending(
          freshParticipants,
        );

        // Someone was added, removed or changed since the first read: recipients come from the locked rows.
        // Rare, so repeating the block and mute lookups under the lock is worth it.
        if (
          participantsKey(freshParticipants) !== participantsKey(participants)
        ) {
          recipients = await this.resolveRecipients(
            conversation.type,
            senderId,
            freshParticipants,
            dto.message.mentionUserIds,
          );
        }

        // A message brings a deleted chat back for its recipients, except people who blocked the sender.
        const deletedParticipantIds = freshParticipants
          .filter(
            (participant) =>
              participant.deletedAt &&
              recipients.deliverableIds.includes(participant.userId) &&
              !recipients.blockerIds.has(participant.userId),
          )
          .map((participant) => participant.userId);
        if (deletedParticipantIds.length > 0) {
          await this.chatRepository.restoreDeletedParticipants(
            tx,
            conversationId,
            deletedParticipantIds,
          );
        }

        const created = await this.chatRepository.createMessage(tx, {
          conversationId,
          senderId,
          participantUserIds: recipients.deliverableIds,
          alreadyReadUserIds: [...recipients.blockerIds],
          ciphertext: payload.ciphertext,
          encryptionMeta: payload.encryptionMeta as
            | Prisma.InputJsonValue
            | undefined,
          contentType: this.resolveContentType(dto.message.contentType),
          clientMessageId: dto.message.clientMessageId,
          replyToId: dto.message.replyToId,
          media,
        });

        await this.eventPublisher.publish(
          {
            type: 'chat.message.sent',
            aggregateId: conversationId,
            payload: {
              messageId: created.id,
              conversationId,
              senderId,
              replyToMessageId: dto.message.replyToId ?? null,
              replyToSenderId: replyTarget?.senderId ?? null,
              recipientUserIds: recipients.notifiableIds,
              mentionedUserIds: recipients.mentionedIds,
            },
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      if (!this.isDuplicateMessageConflict(error)) {
        throw error;
      }

      return this.recoverDuplicateMessage(
        senderId,
        conversationId,
        dto.message.clientMessageId,
      );
    }

    const messagePayload = {
      conversationId,
      messageId: message.id,
      senderId,
      ciphertext: message.ciphertext,
      encryptionMeta: message.encryptionMeta,
      contentType: message.contentType,
      createdAt: message.createdAt,
      clientMessageId: message.clientMessageId,
      replyToId: message.replyToId,
      media: message.media,
    };

    if (recipients.notifiableIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        ...messagePayload,
        recipientUserIds: recipients.notifiableIds,
        shouldNotify: true,
      });
    }

    if (recipients.silentIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        ...messagePayload,
        recipientUserIds: recipients.silentIds,
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
   * Who a message goes to: receipts (deliverableIds, the sender included), who blocked the
   * sender, who gets a notification or a silent delivery, and who is @mentioned. Blocks and
   * mutes are read on their own connection - see the caller for when that happens under the lock.
   */
  private async resolveRecipients(
    conversationType: ChatConversationType,
    senderId: string,
    participants: RecipientCandidate[],
    mentionUserIds: string[] = [],
  ) {
    const deliverable = participants.filter(
      (participant) =>
        participant.userId === senderId ||
        this.chatAccessService.isStateDeliveryEligible(
          conversationType,
          participant.state,
        ),
    );
    const others = deliverable.filter(
      (participant) => participant.userId !== senderId,
    );

    // People who blocked the sender keep their chat as they left it: a deleted or archived chat
    // stays hidden, and the message never counts as unread for them. The sender is not told.
    const blockerIds = await this.chatAccessService.findRecipientsWhoBlocked(
      senderId,
      others.map((participant) => participant.userId),
    );
    const notifiable = await Promise.all(
      others.map((participant) =>
        this.chatAccessService.isRecipientNotifiable(senderId, participant),
      ),
    );

    // A mention reaches someone who muted the chat, but never a non-member or someone who blocked the sender
    const requestedMentions = new Set(mentionUserIds);

    return {
      deliverableIds: deliverable.map((participant) => participant.userId),
      blockerIds,
      notifiableIds: others
        .filter((_, index) => notifiable[index])
        .map((participant) => participant.userId),
      silentIds: others
        .filter((_, index) => !notifiable[index])
        .map((participant) => participant.userId),
      mentionedIds: others
        .filter(
          (participant) =>
            requestedMentions.has(participant.userId) &&
            participant.state === 'ACTIVE' &&
            !blockerIds.has(participant.userId),
        )
        .map((participant) => participant.userId),
    };
  }

  /** Sorts user ids so A->B and B->A resolve to the same direct pair. */
  private normalizeDirectPair(userIdOne: string, userIdTwo: string) {
    return [userIdOne, userIdTwo].sort() as [string, string];
  }

  /** Resolves the stored content type for a payload, defaulting to TEXT. */
  private resolveContentType(contentType?: ChatMessageContentType) {
    return contentType ?? ChatMessageContentType.TEXT;
  }

  /** Validates media references and maps them to repository input; policy lives in MediaService.resolveAttachableMedia. */
  private async resolveChatMessageMedia(
    senderId: string,
    mediaReferences?: ChatMediaReferenceDto[] | null,
  ): Promise<ChatMessageMediaInput[]> {
    // A default param misses an explicit `"media": null`, which passes @IsOptional().
    if (!mediaReferences || mediaReferences.length === 0) {
      return [];
    }

    const uploads = await this.mediaService.resolveAttachableMedia({
      ids: mediaReferences.map((item) => item.mediaUploadId),
      userId: senderId,
      purpose: 'CHAT',
      maxImages: 4,
      maxVideos: 1,
      maxOpaqueBlobs: MAX_OPAQUE_BLOBS_PER_MESSAGE,
      entityLabel: 'chat message',
    });

    const sortOrderById = new Map(
      mediaReferences.map((item, index) => [
        item.mediaUploadId,
        item.sortOrder ?? index,
      ]),
    );

    return uploads.map((upload) => ({
      mediaUploadId: upload.id,
      assetId: upload.assetId!,
      publicId: upload.publicId,
      url: upload.secureUrl!,
      resourceType: upload.resourceType,
      sortOrder: sortOrderById.get(upload.id) ?? 0,
      width: upload.width,
      height: upload.height,
      duration: upload.duration,
      bytes: upload.bytes,
      format: upload.format,
    }));
  }

  private isDuplicateMessageConflict(error: unknown): boolean {
    return isUniqueViolationOn(error, 'clientMessageId');
  }

  /** Two first-ever messages between the same pair racing the ChatDirectPair unique constraint. */
  private isDuplicateDirectPairConflict(error: unknown): boolean {
    return isUniqueViolationOn(error, 'userIdA');
  }

  /** The existing message for this sender and clientMessageId, only if it belongs to the expected conversation. */
  private async recoverDuplicateMessage(
    senderId: string,
    expectedConversationId: string | undefined,
    clientMessageId?: string,
  ) {
    const existingMessage =
      await this.chatRepository.findMessageBySenderClientMessageId(
        senderId,
        clientMessageId,
      );

    if (
      !existingMessage ||
      existingMessage.conversationId !== expectedConversationId
    ) {
      throw new ConflictException(
        'This clientMessageId was already used in a different conversation',
      );
    }

    return {
      conversationId: existingMessage.conversationId,
      message: existingMessage,
      duplicate: true,
    };
  }
}
