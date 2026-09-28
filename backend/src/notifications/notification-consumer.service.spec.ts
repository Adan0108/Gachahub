import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEventType } from '../domain-events/domain-event.types';
import { NotificationConsumerService } from './notification-consumer.service';
import { NotificationService } from './notification.service';
import { ProcessedEventRepository } from './processed-event.repository';

interface TestKafkaDomainEvent {
  eventId: string;
  type: DomainEventType;
  version: number;
  occurredAt: string;
  aggregateId: string;
  payload: unknown;
}

interface TestableNotificationConsumer {
  handleEvent(event: TestKafkaDomainEvent): Promise<void>;
}

type TransactionCallback = (
  transaction: Prisma.TransactionClient,
) => Promise<unknown>;

describe('NotificationConsumerService', () => {
  let service: NotificationConsumerService;

  let createNotificationMock: jest.Mock;
  let claimMock: jest.Mock;
  let transactionMock: Prisma.TransactionClient;
  let transactionRunnerMock: jest.Mock;

  const handleEvent = (
    consumer: NotificationConsumerService,
    event: TestKafkaDomainEvent,
  ): Promise<void> => {
    const testableConsumer =
      consumer as unknown as TestableNotificationConsumer;

    return testableConsumer.handleEvent(event);
  };

  beforeEach(() => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'gachahub-test';
    process.env.KAFKA_NOTIFICATION_GROUP_ID = 'gachahub-notifications-test';

    createNotificationMock = jest.fn();
    claimMock = jest.fn();

    transactionMock = {} as Prisma.TransactionClient;

    transactionRunnerMock = jest.fn(
      async (callback: TransactionCallback): Promise<unknown> => {
        return await callback(transactionMock);
      },
    );

    const notificationService = {
      createNotification: createNotificationMock,
    } as unknown as NotificationService;

    const processedEventRepository = {
      claim: claimMock,
    } as unknown as ProcessedEventRepository;

    const prisma = {
      $transaction: transactionRunnerMock,
    } as unknown as PrismaService;

    service = new NotificationConsumerService(
      notificationService,
      processedEventRepository,
      prisma,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('idempotent event processing', () => {
    it('processes a new post.liked event', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue(null);

      const event: TestKafkaDomainEvent = {
        eventId: 'event-1',
        type: 'post.liked',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'post-1',
        payload: {
          postId: 'post-1',
          postAuthorId: 'user-b',
          actorId: 'user-a',
        },
      };

      await handleEvent(service, event);

      expect(transactionRunnerMock).toHaveBeenCalledTimes(1);

      expect(claimMock).toHaveBeenCalledWith(
        transactionMock,
        'event-1',
        'notifications',
      );

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'POST_LIKED',
          entityType: 'POST',
          entityId: 'post-1',
        },
        transactionMock,
      );
    });

    it('skips an event that was already processed', async () => {
      claimMock.mockResolvedValue(false);

      const event: TestKafkaDomainEvent = {
        eventId: 'event-duplicate',
        type: 'post.liked',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'post-1',
        payload: {
          postId: 'post-1',
          postAuthorId: 'user-b',
          actorId: 'user-a',
        },
      };

      await handleEvent(service, event);

      expect(claimMock).toHaveBeenCalledWith(
        transactionMock,
        'event-duplicate',
        'notifications',
      );

      expect(createNotificationMock).not.toHaveBeenCalled();
    });

    it('propagates an error when notification processing fails', async () => {
      claimMock.mockResolvedValue(true);

      createNotificationMock.mockRejectedValue(
        new Error('notification failed'),
      );

      const event: TestKafkaDomainEvent = {
        eventId: 'event-fail',
        type: 'post.liked',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'post-1',
        payload: {
          postId: 'post-1',
          postAuthorId: 'user-b',
          actorId: 'user-a',
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        'notification failed',
      );

      expect(claimMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('event mappings', () => {
    it('creates POST_COMMENTED for a root comment', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue(null);

      const event: TestKafkaDomainEvent = {
        eventId: 'comment-event-1',
        type: 'comment.created',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'comment-1',
        payload: {
          commentId: 'comment-1',
          postId: 'post-1',
          postAuthorId: 'post-author',
          actorId: 'comment-author',
          parentCommentId: null,
          parentCommentAuthorId: null,
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'post-author',
          actorId: 'comment-author',
          type: 'POST_COMMENTED',
          entityType: 'COMMENT',
          entityId: 'comment-1',
        },
        transactionMock,
      );
    });

    it('creates COMMENT_REPLIED for a reply', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue(null);

      const event: TestKafkaDomainEvent = {
        eventId: 'comment-event-2',
        type: 'comment.created',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'reply-1',
        payload: {
          commentId: 'reply-1',
          postId: 'post-1',
          postAuthorId: 'post-author',
          actorId: 'reply-author',
          parentCommentId: 'comment-1',
          parentCommentAuthorId: 'comment-author',
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'comment-author',
          actorId: 'reply-author',
          type: 'COMMENT_REPLIED',
          entityType: 'COMMENT',
          entityId: 'reply-1',
        },
        transactionMock,
      );
    });

    it('creates USER_FOLLOWED notification', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue(null);

      const event: TestKafkaDomainEvent = {
        eventId: 'follow-event-1',
        type: 'user.followed',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'user-b',
        payload: {
          targetUserId: 'user-b',
          actorId: 'user-a',
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'USER_FOLLOWED',
          entityType: 'USER',
          entityId: 'user-a',
        },
        transactionMock,
      );
    });
  });
});
