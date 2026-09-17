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
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMediaReferenceDto } from './dto/chat-media-reference.dto';
import { MediaService } from '../media/media.service';
import type { ChatMessageMediaInput } from './chat.repository';
import type { MessageEncryptionPort } from './ports/message-encryption.port';
import type { ChatDeliveryPort } from './ports/chat-delivery.port';

/**
 * Sending encrypted messages - the first message in a brand-new direct
 * conversation, and every message after that (direct or group). Pulled out
 * of the former monolithic ChatService as its own concern: duplicate-send
 * idempotency, participant-state eligibility, and delivery fan-out all
 * belong together here, distinct from group management or inbox listing.
 */
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
    this.chatMessageRateLimiter.assertNotRateLimited(senderId);

    if (senderId === dto.recipientUserId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const [userIdA, userIdB] = this.normalizeDirectPair(
      senderId,
      dto.recipientUserId,
    );

    // Three independent reads - none needs any of the others' results, just
    // senderId/recipientUserId/clientMessageId which are already known -
    // so they run concurrently instead of stacking into three round trips
    // before any actual validation can happen. The block check stays a
    // separate, sequential step after the recipient-exists check: batching
    // it in here too would let Promise.all surface a "you're blocked"
    // rejection before a "recipient not found" one even gets checked,
    // silently reordering which error a caller sees for a
    // doesn't-exist-and-blocked-me combination.
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

    // conversationId is only known here when this direct pair already
    // exists (existingPair) - a genuinely brand-new conversation doesn't
    // have one yet for the ciphertext's group_id to be cross-checked
    // against.
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
    // Independent reads (neither depends on the other's result) - run
    // concurrently instead of back-to-back to save one full DB round trip
    // per send, which is real added latency against a remote database.
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

    // deferred until every step that can still throw (payload prep, media
    // validation) has succeeded, so a rejected send never leaves a deleted
    // participant's conversation resurrected for nothing
    if (deletedParticipantIds.length > 0) {
      await this.chatRepository.restoreDeletedParticipants(
        conversationId,
        deletedParticipantIds,
      );
    }

    const recipientParticipants = deliverableParticipants.filter(
      (participant) => participant.userId !== senderId,
    );

    // Doesn't depend on the message row at all (just sender + participant
    // state) - fired here instead of after createMessage so its DB round
    // trip overlaps with the insert instead of stacking after it.
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

      // Unneeded on this path - a duplicate was already delivered by its
      // original send. Acknowledged explicitly so firing the promise above
      // eagerly can't surface as an unhandled rejection here.
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
   * Validates media references and resolves them into repository-ready
   * input, shared by createDirectMessage and sendMessageToExistingConversation.
   *
   * Ownership/purpose/status/count/mix validation lives in
   * MediaService.resolveAttachableMedia, shared with PostsService's attach
   * flow. Only the final mapping to ChatMessageMedia's shape is chat-specific.
   */
  private async resolveChatMessageMedia(
    senderId: string,
    mediaReferences?: ChatMediaReferenceDto[] | null,
  ): Promise<ChatMessageMediaInput[]> {
    // a default param only covers undefined, and an explicit `"media": null`
    // in the request body passes @IsOptional() validation unchanged
    if (!mediaReferences || mediaReferences.length === 0) {
      return [];
    }

    const uploads = await this.mediaService.resolveAttachableMedia({
      ids: mediaReferences.map((item) => item.mediaUploadId),
      userId: senderId,
      purpose: 'CHAT',
      maxImages: 4,
      maxVideos: 1,
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

  /**
   * True when the error is a Prisma unique-constraint violation (P2002).
   */
  private isUniqueConstraintViolation(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /**
   * Checks a unique-constraint error's target field list for one field.
   *
   * Handles both array and string target shapes Prisma can return.
   */
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

  /**
   * Two first-ever messages between the same pair racing the ChatDirectPair
   * unique constraint, different collision than the message id one above
   */
  private isDuplicateDirectPairConflict(error: unknown): boolean {
    return (
      this.isUniqueConstraintViolation(error) &&
      this.constraintTargetIncludes(error, 'userIdA')
    );
  }

  /**
   * Fetches the message that already exists for this sender and clientMessageId,
   * only if it belongs to the conversation this call actually expected.
   */
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
