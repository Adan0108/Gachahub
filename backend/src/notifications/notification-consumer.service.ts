import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

import type { DomainEventType } from '../domain-events/domain-event.types';
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

  /**
   * Parses a Kafka message into a domain event and passes it through
   * the notification-processing pipeline.
   *
   * Processing errors are rethrown so Kafka does not silently treat
   * a failed event as successfully consumed.
   */
  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    if (!message.value) {
      return;
    }

    try {
      const event = JSON.parse(message.value.toString()) as KafkaDomainEvent;

      await this.handleEvent(event);

      this.logger.debug(
        `Consumed ${event.type} event ${event.eventId} from ${topic}[${partition}]`,
      );
    } catch (error) {
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
    const notification = await this.prisma.$transaction(
      async (transaction): Promise<NotificationRecord | null> => {
        const claimed = await this.processedEventRepository.claim(
          transaction,
          event.eventId,
          NOTIFICATION_CONSUMER,
        );

        if (!claimed) {
          this.logger.debug(
            `Skipping already processed event ${event.eventId}`,
          );

          return null;
        }

        return this.processEvent(event, transaction);
      },
    );

    /*
     * The database transaction has successfully committed at this point.
     * Socket delivery is intentionally kept outside the transaction.
     */
    if (notification) {
      this.socketNotificationDeliveryService.publish(notification);
    }
  }

  /**
   * Routes a domain event to the appropriate notification handler.
   *
   * Supported events return the created notification so it can be
   * delivered through Socket.IO after the database transaction commits.
   * Unsupported or irrelevant events return null.
   */
  private async processEvent(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<NotificationRecord | null> {
    switch (event.type) {
      case 'post.liked':
        return this.handlePostLiked(event, transaction);

      case 'comment.created':
        return this.handleCommentCreated(event, transaction);

      case 'user.followed':
        return this.handleUserFollowed(event, transaction);

      case 'user.mentioned':
        this.logger.debug(`Ignoring unsupported event ${event.type}`);
        return null;

      case 'chat.message.sent':
      case 'chat.participant.added':
        return null;

      default:
        this.logger.warn(`Unknown domain event type: ${String(event.type)}`);
        return null;
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
