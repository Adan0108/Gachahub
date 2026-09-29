import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

import type {
  DomainEventPayloadMap,
  DomainEventType,
} from '../domain-events/domain-event.types';
import type {
  Notification as NotificationRecord,
  Prisma,
} from '../generated/prisma/client';
import { KAFKA_TOPICS } from '../kafka/kafka-topics';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { ProcessedEventRepository } from './processed-event.repository';
import { SocketNotificationDeliveryService } from './realtime/socket-notification-delivery.service';

interface KafkaDomainEvent {
  eventId: string;
  type: DomainEventType;
  version: number;
  occurredAt: string;
  aggregateId: string;
  payload: unknown;
}

type ChatMessageSentPayload = DomainEventPayloadMap['chat.message.sent'];
type ChatParticipantAddedPayload =
  DomainEventPayloadMap['chat.participant.added'];

/** Group member cap (CreateGroupChatDto/UpdateGroupMembersDto: 99) plus one, so recipientUserIds can never legitimately exceed it. */
const MAX_CHAT_RECIPIENTS = 100;

/** An event that can never succeed, no matter how many times Kafka redelivers it - handleMessage logs and drops it instead of retrying. */
export class PermanentEventError extends Error {}

/** Validates the payload shape; the thrown message names only the bad field, never its values. */
function asChatMessageSentPayload(
  payload: unknown,
  eventId: string,
): ChatMessageSentPayload {
  const candidate = payload as Partial<ChatMessageSentPayload> | null;

  const problem = !candidate
    ? 'payload is not an object'
    : typeof candidate.messageId !== 'string'
      ? 'messageId is not a string'
      : typeof candidate.conversationId !== 'string'
        ? 'conversationId is not a string'
        : typeof candidate.senderId !== 'string'
          ? 'senderId is not a string'
          : !(
                candidate.replyToMessageId === null ||
                typeof candidate.replyToMessageId === 'string'
              )
            ? 'replyToMessageId is neither null nor a string'
            : !(
                  candidate.replyToSenderId === null ||
                  typeof candidate.replyToSenderId === 'string'
                )
              ? 'replyToSenderId is neither null nor a string'
              : !Array.isArray(candidate.recipientUserIds) ||
                  !candidate.recipientUserIds.every(
                    (id) => typeof id === 'string',
                  )
                ? 'recipientUserIds is not an array of strings'
                : candidate.recipientUserIds.length > MAX_CHAT_RECIPIENTS
                  ? `recipientUserIds has ${candidate.recipientUserIds.length} entries`
                  : undefined;

  if (problem) {
    throw new PermanentEventError(
      `Malformed chat.message.sent payload for event ${eventId}: ${problem}`,
    );
  }

  return candidate as ChatMessageSentPayload;
}

/** Validates the payload shape; the thrown message names only the bad field, never its values. */
function asChatParticipantAddedPayload(
  payload: unknown,
  eventId: string,
): ChatParticipantAddedPayload {
  const candidate = payload as Partial<ChatParticipantAddedPayload> | null;

  const problem = !candidate
    ? 'payload is not an object'
    : typeof candidate.conversationId !== 'string'
      ? 'conversationId is not a string'
      : typeof candidate.addedUserId !== 'string'
        ? 'addedUserId is not a string'
        : typeof candidate.actorId !== 'string'
          ? 'actorId is not a string'
          : candidate.state !== 'ACTIVE' &&
              candidate.state !== 'JOINING' &&
              candidate.state !== 'PENDING'
            ? 'state is not one of ACTIVE, JOINING, PENDING'
            : undefined;

  if (problem) {
    throw new PermanentEventError(
      `Malformed chat.participant.added payload for event ${eventId}: ${problem}`,
    );
  }

  return candidate as ChatParticipantAddedPayload;
}

const STARTUP_MAX_ATTEMPTS = 5;
const STARTUP_RETRY_DELAY_MS = 2_000;
const NOTIFICATION_CONSUMER = 'notifications';

@Injectable()
export class NotificationConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationConsumerService.name);

  private readonly consumer: Consumer;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly processedEventRepository: ProcessedEventRepository,
    private readonly prisma: PrismaService,
    private readonly socketNotificationDeliveryService: SocketNotificationDeliveryService,
  ) {
    const brokers = process.env.KAFKA_BROKERS?.split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);

    if (!brokers || brokers.length === 0) {
      throw new Error('KAFKA_BROKERS is missing');
    }

    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'gachahub-backend',
      brokers,
    });

    this.consumer = kafka.consumer({
      groupId:
        process.env.KAFKA_NOTIFICATION_GROUP_ID ?? 'gachahub-notifications',
    });
  }

  /**
   * Starts the Kafka notification consumer when the NestJS module
   * has finished initializing.
   */
  async onModuleInit(): Promise<void> {
    await this.startConsumer();
  }

  /**
   * Gracefully disconnects the Kafka consumer when the application
   * or module is shutting down.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.consumer.disconnect();

      this.logger.log('Notification Kafka consumer disconnected');
    } catch (error) {
      this.logger.warn(
        `Failed to disconnect Kafka consumer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Connects the notification consumer to Kafka and subscribes to
   * the domain-event topics used by the notification system.
   *
   * Startup failures are retried because Kafka or its topics may not
   * be immediately available when the backend starts.
   */
  private async startConsumer(): Promise<void> {
    for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt++) {
      try {
        await this.consumer.connect();

        await this.consumer.subscribe({
          topics: [KAFKA_TOPICS.POSTS, KAFKA_TOPICS.SOCIAL],
        });

        await this.consumer.run({
          eachMessage: async (payload) => {
            await this.handleMessage(payload);
          },
        });

        this.logger.log('Notification Kafka consumer started');

        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `Kafka consumer startup failed (${attempt}/${STARTUP_MAX_ATTEMPTS}): ${message}`,
        );

        /*
         * Reset the connection before attempting another startup.
         */
        try {
          await this.consumer.disconnect();
        } catch {
          // Ignore disconnect failure during startup recovery.
        }

        if (attempt === STARTUP_MAX_ATTEMPTS) {
          this.logger.error('Notification Kafka consumer failed to start');

          throw error;
        }

        await this.delay(STARTUP_RETRY_DELAY_MS);
      }
    }
  }

  /** Parses and processes one Kafka message; permanent failures are logged and skipped, transient ones rethrown so Kafka retries. */
  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    if (!message.value) {
      return;
    }

    let event: KafkaDomainEvent;

    try {
      event = JSON.parse(message.value.toString()) as KafkaDomainEvent;
    } catch (error) {
      this.logger.error(
        `Skipping unparseable message from ${topic}[${partition}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return;
    }

    try {
      await this.handleEvent(event);

      this.logger.debug(
        `Consumed ${event.type} event ${event.eventId} from ${topic}[${partition}]`,
      );
    } catch (error) {
      if (error instanceof PermanentEventError) {
        this.logger.error(
          `Skipping unusable ${event.type} event ${event.eventId}: ${error.message}`,
        );

        return;
      }

      this.logger.error(
        'Failed to process Kafka notification event',
        error instanceof Error ? error.stack : String(error),
      );

      throw error;
    }
  }

  /**
   * Processes one domain event atomically.
   *
   * The ProcessedEvent claim and notification creation happen inside
   * the same database transaction. This guarantees idempotency:
   * either both changes commit or both are rolled back.
   *
   * Realtime delivery happens only after the transaction completes,
   * ensuring clients never receive a notification that was later
   * rolled back in the database.
   */
  private async handleEvent(event: KafkaDomainEvent): Promise<void> {
    const notifications = await this.prisma.$transaction(
      async (transaction): Promise<NotificationRecord[]> => {
        const claimed = await this.processedEventRepository.claim(
          transaction,
          event.eventId,
          NOTIFICATION_CONSUMER,
        );

        if (!claimed) {
          this.logger.debug(
            `Skipping already processed event ${event.eventId}`,
          );

          return [];
        }

        return this.processEvent(event, transaction);
      },
    );

    /*
     * The database transaction has successfully committed at this point.
     * Socket delivery is intentionally kept outside the transaction.
     */
    for (const notification of notifications) {
      this.socketNotificationDeliveryService.publish(notification);
    }
  }

  /**
   * Routes a domain event to the appropriate notification handler.
   *
   * Supported events return the notifications created so each can be
   * delivered through Socket.IO after the database transaction commits.
   * A chat message sent to a group, or added to several members at once,
   * can produce more than one. Unsupported or irrelevant events return [].
   */
  private async processEvent(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord[]> {
    switch (event.type) {
      case 'post.liked': {
        const notification = await this.handlePostLiked(event, transaction);
        return notification ? [notification] : [];
      }

      case 'comment.created': {
        const notification = await this.handleCommentCreated(
          event,
          transaction,
        );
        return notification ? [notification] : [];
      }

      case 'user.followed': {
        const notification = await this.handleUserFollowed(event, transaction);
        return notification ? [notification] : [];
      }

      case 'user.mentioned':
        this.logger.debug(`Ignoring unsupported event ${event.type}`);
        return [];

      case 'chat.message.sent':
        return this.handleChatMessageSent(event, transaction);

      case 'chat.participant.added': {
        const notification = await this.handleChatParticipantAdded(
          event,
          transaction,
        );
        return notification ? [notification] : [];
      }

      default:
        this.logger.warn(`Unknown domain event type: ${String(event.type)}`);
        return [];
    }
  }

  /**
   * Converts a post.liked domain event into a POST_LIKED notification
   * for the author of the liked post.
   */
  private async handlePostLiked(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord | null> {
    const payload = event.payload as {
      postId: string;
      postAuthorId: string;
      actorId: string;
    };

    return this.notificationService.createNotification(
      {
        recipientId: payload.postAuthorId,
        actorId: payload.actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: payload.postId,
      },
      transaction,
    );
  }

  /**
   * Converts a comment.created event into either:
   *
   * - POST_COMMENTED when a user comments directly on a post.
   * - COMMENT_REPLIED when a user replies to another comment.
   */
  private async handleCommentCreated(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord | null> {
    const payload = event.payload as {
      commentId: string;
      postId: string;
      postAuthorId: string;
      actorId: string;
      parentCommentId: string | null;
      parentCommentAuthorId: string | null;
    };

    if (payload.parentCommentId && payload.parentCommentAuthorId) {
      return this.notificationService.createNotification(
        {
          recipientId: payload.parentCommentAuthorId,
          actorId: payload.actorId,
          type: 'COMMENT_REPLIED',
          entityType: 'COMMENT',
          entityId: payload.commentId,
        },
        transaction,
      );
    }

    return this.notificationService.createNotification(
      {
        recipientId: payload.postAuthorId,
        actorId: payload.actorId,
        type: 'POST_COMMENTED',
        entityType: 'COMMENT',
        entityId: payload.commentId,
      },
      transaction,
    );
  }

  /**
   * Converts a user.followed domain event into a USER_FOLLOWED
   * notification for the followed user.
   */
  private async handleUserFollowed(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord | null> {
    const payload = event.payload as {
      targetUserId: string;
      actorId: string;
    };

    return this.notificationService.createNotification(
      {
        recipientId: payload.targetUserId,
        actorId: payload.actorId,
        type: 'USER_FOLLOWED',
        entityType: 'USER',
        entityId: payload.actorId,
      },
      transaction,
    );
  }

  /** chat.message.sent -> MESSAGE_REPLIED for the reply target, MESSAGE_RECEIVED for the rest of recipientUserIds (both pre-resolved by ChatMessagingService). */
  private async handleChatMessageSent(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord[]> {
    const payload = asChatMessageSentPayload(event.payload, event.eventId);

    // Reply target must be a different, notifiable recipient.
    const repliedToUserId =
      payload.replyToSenderId &&
      payload.replyToSenderId !== payload.senderId &&
      payload.recipientUserIds.includes(payload.replyToSenderId)
        ? payload.replyToSenderId
        : null;

    const replyNotification = repliedToUserId
      ? await this.notificationService.createNotification(
          {
            recipientId: repliedToUserId,
            actorId: payload.senderId,
            type: 'MESSAGE_REPLIED',
            entityType: 'MESSAGE',
            entityId: payload.messageId,
          },
          transaction,
        )
      : null;

    // Exclude the reply target so they don't get both notification types.
    const receivedRecipientIds = payload.recipientUserIds.filter(
      (id) => id !== repliedToUserId,
    );

    const receivedNotifications =
      await this.notificationService.createManyNotifications(
        {
          recipientIds: receivedRecipientIds,
          actorId: payload.senderId,
          type: 'MESSAGE_RECEIVED',
          entityType: 'MESSAGE',
          entityId: payload.messageId,
        },
        transaction,
      );

    return replyNotification
      ? [replyNotification, ...receivedNotifications]
      : receivedNotifications;
  }

  /** chat.participant.added -> GROUP_ADDED (ACTIVE/JOINING) or GROUP_INVITE_PENDING (PENDING). */
  private async handleChatParticipantAdded(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord | null> {
    const payload = asChatParticipantAddedPayload(event.payload, event.eventId);

    return this.notificationService.createNotification(
      {
        recipientId: payload.addedUserId,
        actorId: payload.actorId,
        type:
          payload.state === 'PENDING' ? 'GROUP_INVITE_PENDING' : 'GROUP_ADDED',
        entityType: 'CONVERSATION',
        entityId: payload.conversationId,
      },
      transaction,
    );
  }

  /**
   * Waits for the requested duration before another Kafka startup
   * attempt is made.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
