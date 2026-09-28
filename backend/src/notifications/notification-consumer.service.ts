import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

import type { DomainEventType } from '../domain-events/domain-event.types';
import type { Prisma } from '../generated/prisma/client';
import { KAFKA_TOPICS } from '../kafka/kafka-topics';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { ProcessedEventRepository } from './processed-event.repository';

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

  async onModuleInit(): Promise<void> {
    await this.startConsumer();
  }

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

  private async handleEvent(event: KafkaDomainEvent): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const claimed = await this.processedEventRepository.claim(
        transaction,
        event.eventId,
        NOTIFICATION_CONSUMER,
      );

      if (!claimed) {
        this.logger.debug(`Skipping already processed event ${event.eventId}`);

        return;
      }

      await this.processEvent(event, transaction);
    });
  }

  private async processEvent(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    switch (event.type) {
      case 'post.liked':
        await this.handlePostLiked(event, transaction);
        return;

      case 'comment.created':
        await this.handleCommentCreated(event, transaction);
        return;

      case 'user.followed':
        await this.handleUserFollowed(event, transaction);
        return;

      case 'user.mentioned':
        this.logger.debug(`Ignoring unsupported event ${event.type}`);
        return;

      case 'chat.message.sent':
      case 'chat.participant.added':
        return;

      default:
        this.logger.warn(`Unknown domain event type: ${String(event.type)}`);
    }
  }

  private async handlePostLiked(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const payload = event.payload as {
      postId: string;
      postAuthorId: string;
      actorId: string;
    };

    await this.notificationService.createNotification(
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

  private async handleCommentCreated(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const payload = event.payload as {
      commentId: string;
      postId: string;
      postAuthorId: string;
      actorId: string;
      parentCommentId: string | null;
      parentCommentAuthorId: string | null;
    };

    if (payload.parentCommentId && payload.parentCommentAuthorId) {
      await this.notificationService.createNotification(
        {
          recipientId: payload.parentCommentAuthorId,
          actorId: payload.actorId,
          type: 'COMMENT_REPLIED',
          entityType: 'COMMENT',
          entityId: payload.commentId,
        },
        transaction,
      );

      return;
    }

    await this.notificationService.createNotification(
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

  private async handleUserFollowed(
    event: KafkaDomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const payload = event.payload as {
      targetUserId: string;
      actorId: string;
    };

    await this.notificationService.createNotification(
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
