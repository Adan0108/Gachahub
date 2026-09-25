import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatMessageContentType, Prisma } from '../generated/prisma/client';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { ChatDevicesService } from '../chat-devices/chat-devices.service';
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMediaReferenceDto } from './dto/chat-media-reference.dto';
import { MediaService } from '../media/media.service';
import { MAX_OPAQUE_BLOBS_PER_MESSAGE } from '../media/opaque-blob';
import type { ChatMessageMediaInput } from './chat.repository';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

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
      ReturnType<typeof this.chatRepository.createDirectConversationWithMessage>
    >;

    try {
      result = await this.chatRepository.createDirectConversationWithMessage({
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

    const participants = conversation.participants;

    const senderParticipant = participants.find(
      (participant) => participant.userId === senderId,
    );

    if (!senderParticipant) {
      throw new NotFoundException('Conversation not found');
    }

    if (senderParticipant.state !== 'ACTIVE') {
      throw new ForbiddenException('You cannot send messages here');
    }

    this.chatAccessService.assertNoMembershipChangePending(participants);

    if (conversation.type === 'DIRECT') {
      const recipient = participants.find(
        (participant) => participant.userId !== senderId,
      );

      if (recipient) {
        await this.chatAccessService.assertSenderHasNotBlockedRecipient(
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

    await this.chatAccessService.assertValidReplyTarget(
      conversationId,
      dto.message.replyToId,
    );

    const stateEligibleParticipants = participants.filter(
      (participant) =>
        participant.userId === senderId ||
        this.chatAccessService.isStateDeliveryEligible(
          conversation.type,
          participant.state,
        ),
    );

    const deletedParticipantIds = stateEligibleParticipants
      .filter((participant) => participant.deletedAt)
      .map((participant) => participant.userId);

    const deliverableParticipants = stateEligibleParticipants;

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

    // Deferred until every step that can still throw has succeeded.
    if (deletedParticipantIds.length > 0) {
      await this.chatRepository.restoreDeletedParticipants(
        conversationId,
        deletedParticipantIds,
      );
    }

    const recipientParticipants = deliverableParticipants.filter(
      (participant) => participant.userId !== senderId,
    );

    // Independent of the message row; fired early so it overlaps the insert.
    const notifiableFlagsPromise = Promise.all(
      recipientParticipants.map((participant) =>
        this.chatAccessService.isRecipientNotifiable(senderId, participant),
      ),
    );

    let message: Awaited<ReturnType<typeof this.chatRepository.createMessage>>;
    try {
      message = await this.chatRepository.createMessage({
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
        media,
      });
    } catch (error) {
      if (!this.isDuplicateMessageConflict(error)) {
        throw error;
      }

      // Unneeded for a duplicate; acknowledged so the eager promise cannot become an unhandled rejection.
      notifiableFlagsPromise.catch(() => undefined);

      return this.recoverDuplicateMessage(
        senderId,
        conversationId,
        dto.message.clientMessageId,
      );
    }

    const notifiableFlags = await notifiableFlagsPromise;

    const notifiableRecipientIds = recipientParticipants
      .filter((_, index) => notifiableFlags[index])
      .map((participant) => participant.userId);

    const silentRecipientIds = recipientParticipants
      .filter((_, index) => !notifiableFlags[index])
      .map((participant) => participant.userId);

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

    if (notifiableRecipientIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        ...messagePayload,
        recipientUserIds: notifiableRecipientIds,
        shouldNotify: true,
      });
    }

    if (silentRecipientIds.length > 0) {
      await this.chatDelivery.publishMessageCreated({
        ...messagePayload,
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

  /** True for a Prisma unique-constraint violation (P2002). */
  private isUniqueConstraintViolation(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /** Checks a unique-constraint error's target (array or string) for one field. */
  private constraintTargetIncludes(
    error: Prisma.PrismaClientKnownRequestError,
    field: string,
  ): boolean {
    const conflictingFields = error.meta?.target;

    return Array.isArray(conflictingFields)
      ? conflictingFields.includes(field)
      : typeof conflictingFields === 'string' &&
          conflictingFields.includes(field);
  }

  private isDuplicateMessageConflict(error: unknown): boolean {
    return (
      this.isUniqueConstraintViolation(error) &&
      this.constraintTargetIncludes(error, 'clientMessageId')
    );
  }

  /** Two first-ever messages between the same pair racing the ChatDirectPair unique constraint. */
  private isDuplicateDirectPairConflict(error: unknown): boolean {
    return (
      this.isUniqueConstraintViolation(error) &&
      this.constraintTargetIncludes(error, 'userIdA')
    );
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
