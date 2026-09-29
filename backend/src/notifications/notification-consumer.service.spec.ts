import type { Consumer } from 'kafkajs';
import type { DomainEventType } from '../domain-events/domain-event.types';
import type { Prisma } from '../generated/prisma/client';
import { KAFKA_TOPICS } from '../kafka/kafka-topics';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationConsumerService } from './notification-consumer.service';
import { NotificationService } from './notification.service';
import { ProcessedEventRepository } from './processed-event.repository';
import { SocketNotificationDeliveryService } from './realtime/socket-notification-delivery.service';

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
  let createManyNotificationsMock: jest.Mock;
  let claimMock: jest.Mock;
  let transactionMock: Prisma.TransactionClient;
  let transactionRunnerMock: jest.Mock;

  const publishNotificationMock = jest.fn();

  const socketNotificationDeliveryService = {
    publish: publishNotificationMock,
  } as unknown as SocketNotificationDeliveryService;

  /**
   * Provides controlled access to the private handleEvent method
   * so the consumer's event-processing flow can be unit tested
   * without changing the production method visibility.
   */
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
    // Default double for the MESSAGE_RECEIVED fan-out: every requested recipient becomes a
    // notification, mirroring createManyNotifications with no muted/deleted/banned exclusions.
    createManyNotificationsMock = jest.fn(
      (input: { recipientIds: readonly string[] }) =>
        Promise.resolve(
          input.recipientIds.map((recipientId) => ({
            id: `notification-${recipientId}`,
            recipientId,
          })),
        ),
    );
    claimMock = jest.fn();

    transactionMock = {} as Prisma.TransactionClient;

    transactionRunnerMock = jest.fn(
      async (callback: TransactionCallback): Promise<unknown> => {
        return await callback(transactionMock);
      },
    );

    const notificationService = {
      createNotification: createNotificationMock,
      createManyNotifications: createManyNotificationsMock,
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
      socketNotificationDeliveryService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Kafka subscription', () => {
    it('subscribes to the posts, social, and chat topics', async () => {
      const consumer = (
        service as unknown as {
          consumer: Consumer;
        }
      ).consumer;
      const connectSpy = jest
        .spyOn(consumer, 'connect')
        .mockResolvedValue(undefined);
      const subscribeSpy = jest
        .spyOn(consumer, 'subscribe')
        .mockResolvedValue(undefined);
      const runSpy = jest.spyOn(consumer, 'run').mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(subscribeSpy).toHaveBeenCalledWith({
        topics: [KAFKA_TOPICS.POSTS, KAFKA_TOPICS.SOCIAL, KAFKA_TOPICS.CHAT],
      });
      expect(runSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotent event processing', () => {
    /**
     * Verifies that a new event is claimed, converted into a notification,
     * committed through the transaction, and then published in realtime.
     */
    it('processes a new post.liked event and publishes it in realtime', async () => {
      claimMock.mockResolvedValue(true);

      const notification = {
        id: 'notification-1',
        recipientId: 'user-b',
        actorId: 'user-a',
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: 'post-1',
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      createNotificationMock.mockResolvedValue(notification);

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

      expect(publishNotificationMock).toHaveBeenCalledWith(notification);
    });

    /**
     * Verifies that an already-processed event is skipped completely
     * and does not create or publish another notification.
     */
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
      expect(publishNotificationMock).not.toHaveBeenCalled();
    });

    it('does not create or emit twice for a duplicate chat event', async () => {
      claimMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const notification = {
        id: 'notification-user-b',
        recipientId: 'user-b',
      };
      createManyNotificationsMock.mockResolvedValue([notification]);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-duplicate',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: ['user-b'],
        },
      };

      await handleEvent(service, event);
      await handleEvent(service, event);

      expect(claimMock).toHaveBeenCalledTimes(2);
      expect(createManyNotificationsMock).toHaveBeenCalledTimes(1);
      expect(publishNotificationMock).toHaveBeenCalledTimes(1);
      expect(publishNotificationMock).toHaveBeenCalledWith(notification);
    });

    /**
     * Verifies that notification-processing failures propagate upward
     * and that realtime delivery does not happen when the transaction fails.
     */
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
      expect(publishNotificationMock).not.toHaveBeenCalled();
    });

    it('does not emit a chat notification when processing fails', async () => {
      claimMock.mockResolvedValue(true);
      createManyNotificationsMock.mockRejectedValue(
        new Error('chat notification failed'),
      );

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-fail',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: ['user-b'],
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        'chat notification failed',
      );

      expect(claimMock).toHaveBeenCalledTimes(1);
      expect(createManyNotificationsMock).toHaveBeenCalledTimes(1);
      expect(publishNotificationMock).not.toHaveBeenCalled();
    });

    /**
     * Verifies that a successfully processed event which intentionally
     * produces no notification also produces no realtime socket event.
     */
    it('does not publish when notification creation returns null', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue(null);

      const event: TestKafkaDomainEvent = {
        eventId: 'event-null',
        type: 'post.liked',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'post-1',
        payload: {
          postId: 'post-1',
          postAuthorId: 'user-a',
          actorId: 'user-a',
        },
      };

      await handleEvent(service, event);

      expect(claimMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
      expect(publishNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe('event mappings', () => {
    /**
     * Verifies that a root-level comment creates a POST_COMMENTED
     * notification for the post author.
     */
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

    /**
     * Verifies that a reply creates a COMMENT_REPLIED notification
     * for the parent comment author.
     */
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

    /**
     * Verifies that a follow event creates a USER_FOLLOWED notification
     * for the target user.
     */
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

    /**
     * Verifies that a plain (non-reply) chat message notifies exactly the
     * recipientUserIds already on the event - the producer, not this
     * consumer, decided that audience via isRecipientNotifiable.
     */
    it('notifies every id in recipientUserIds for a plain message', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-1',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: ['user-b', 'user-c'],
        },
      };

      await handleEvent(service, event);

      expect(createManyNotificationsMock).toHaveBeenCalledWith(
        {
          recipientIds: ['user-b', 'user-c'],
          actorId: 'user-a',
          type: 'MESSAGE_RECEIVED',
          entityType: 'MESSAGE',
          entityId: 'message-1',
        },
        transactionMock,
      );
      expect(publishNotificationMock).toHaveBeenCalledTimes(2);
    });

    /**
     * Verifies that a muted or blocked recipient - simply absent from
     * recipientUserIds - gets no notification, without this consumer having
     * to know anything about mute/block itself.
     */
    it('does not notify a recipient the producer already excluded (muted or blocked)', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-muted',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          // user-muted was a real ACTIVE participant, just not in this list.
          recipientUserIds: ['user-b'],
        },
      };

      await handleEvent(service, event);

      expect(createManyNotificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ recipientIds: ['user-b'] }),
        transactionMock,
      );
    });

    /**
     * Verifies that a reply produces MESSAGE_REPLIED for the original
     * message's author AND MESSAGE_RECEIVED for everyone else notifiable -
     * a reply must not silence the rest of a group.
     */
    it('creates MESSAGE_REPLIED for the reply target and MESSAGE_RECEIVED for everyone else', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue({ id: 'notification-b' });

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-2',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-2',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: 'message-1',
          replyToSenderId: 'user-b',
          recipientUserIds: ['user-b', 'user-c'],
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledTimes(1);
      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'MESSAGE_REPLIED',
          entityType: 'MESSAGE',
          entityId: 'message-2',
        },
        transactionMock,
      );
      expect(createManyNotificationsMock).toHaveBeenCalledWith(
        {
          recipientIds: ['user-c'],
          actorId: 'user-a',
          type: 'MESSAGE_RECEIVED',
          entityType: 'MESSAGE',
          entityId: 'message-2',
        },
        transactionMock,
      );
    });

    /**
     * Verifies that replying to your own message still notifies the rest of
     * a group as MESSAGE_RECEIVED - only the (nonexistent) reply-to-self
     * notification is skipped.
     */
    it('skips MESSAGE_REPLIED but still notifies others when replying to your own message', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-3',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-2',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: 'message-1',
          replyToSenderId: 'user-a',
          recipientUserIds: ['user-c'],
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).not.toHaveBeenCalled();
      expect(createManyNotificationsMock).toHaveBeenCalledWith(
        {
          recipientIds: ['user-c'],
          actorId: 'user-a',
          type: 'MESSAGE_RECEIVED',
          entityType: 'MESSAGE',
          entityId: 'message-2',
        },
        transactionMock,
      );
    });

    /**
     * Verifies that a reply target who was never in recipientUserIds (they
     * were muted/blocked/not-yet-active) gets no MESSAGE_REPLIED, but the
     * rest of the audience is unaffected.
     */
    it('does not notify a reply target who was excluded from recipientUserIds', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-4',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-2',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: 'message-1',
          replyToSenderId: 'user-b',
          // user-b (the reply target) isn't in this list - muted, blocked, or similar.
          recipientUserIds: ['user-c'],
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).not.toHaveBeenCalled();
      expect(createManyNotificationsMock).toHaveBeenCalledWith(
        {
          recipientIds: ['user-c'],
          actorId: 'user-a',
          type: 'MESSAGE_RECEIVED',
          entityType: 'MESSAGE',
          entityId: 'message-2',
        },
        transactionMock,
      );
    });

    /**
     * A malformed payload (missing recipientUserIds, wrong types) must fail
     * loudly rather than silently reading `undefined` fields.
     */
    it('throws on a malformed chat.message.sent payload', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-bad',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          // recipientUserIds missing entirely
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        /Malformed chat\.message\.sent payload/,
      );
      expect(createNotificationMock).not.toHaveBeenCalled();
      expect(createManyNotificationsMock).not.toHaveBeenCalled();
    });

    /**
     * recipientUserIds elements must be validated too, not just "is an array" - a non-string
     * entry would otherwise reach Prisma as a real query and throw a transient-looking error,
     * turning a permanently bad event into an infinite retry.
     */
    it('throws on a recipientUserIds array containing non-string entries', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-bad-ids',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: ['user-b', 123, null],
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        /recipientUserIds is not an array of strings/,
      );
      expect(createManyNotificationsMock).not.toHaveBeenCalled();
    });

    /**
     * An unbounded recipientUserIds is the same failure from the other side: a malformed event
     * shouldn't be able to turn into one enormous IN-list query and createMany.
     */
    it('throws on a recipientUserIds array longer than the group cap allows', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-too-many',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: Array.from(
            { length: 101 },
            (_, index) => `user-${index}`,
          ),
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        /recipientUserIds has 101 entries/,
      );
      expect(createManyNotificationsMock).not.toHaveBeenCalled();
    });

    /**
     * A malformed-payload error must never leak the payload's own values
     * (who's messaging whom) into the log/error message - only which field
     * was invalid.
     */
    it('does not leak payload values in a malformed-payload error message', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'chat-event-bad-2',
        type: 'chat.message.sent',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          messageId: 'message-1',
          conversationId: 'conversation-1',
          senderId: 'user-a',
          replyToMessageId: null,
          replyToSenderId: null,
          recipientUserIds: ['user-super-secret-recipient'],
          extra: 'not-a-valid-field-but-should-never-appear-either',
        },
      };
      // Force a validation failure downstream of recipientUserIds so the error is reachable.
      (event.payload as { recipientUserIds: unknown }).recipientUserIds =
        'not-an-array';

      await expect(handleEvent(service, event)).rejects.toThrow(
        /recipientUserIds is not an array/,
      );
      await expect(handleEvent(service, event)).rejects.not.toThrow(
        /user-super-secret-recipient/,
      );
    });

    /**
     * Verifies that an ACTIVE participant add creates GROUP_ADDED.
     */
    it('creates GROUP_ADDED when a member joins directly', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue({ id: 'notification-1' });

      const event: TestKafkaDomainEvent = {
        eventId: 'participant-event-1',
        type: 'chat.participant.added',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          conversationId: 'conversation-1',
          addedUserId: 'user-b',
          actorId: 'user-a',
          state: 'ACTIVE',
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'GROUP_ADDED',
          entityType: 'CONVERSATION',
          entityId: 'conversation-1',
        },
        transactionMock,
      );
    });

    /**
     * Verifies that a PENDING participant add creates GROUP_INVITE_PENDING.
     */
    it('creates GROUP_INVITE_PENDING when a member must accept an invite', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue({ id: 'notification-1' });

      const event: TestKafkaDomainEvent = {
        eventId: 'participant-event-2',
        type: 'chat.participant.added',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          conversationId: 'conversation-1',
          addedUserId: 'user-b',
          actorId: 'user-a',
          state: 'PENDING',
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'GROUP_INVITE_PENDING',
          entityType: 'CONVERSATION',
          entityId: 'conversation-1',
        },
        transactionMock,
      );
    });

    /**
     * Verifies that JOINING (added, but MLS hasn't caught them up yet) still
     * reads as GROUP_ADDED, not GROUP_INVITE_PENDING - they weren't asked to
     * accept anything, they're just waiting on a Commit.
     */
    it('creates GROUP_ADDED when a member joins directly but is still JOINING in MLS', async () => {
      claimMock.mockResolvedValue(true);
      createNotificationMock.mockResolvedValue({ id: 'notification-1' });

      const event: TestKafkaDomainEvent = {
        eventId: 'participant-event-3',
        type: 'chat.participant.added',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          conversationId: 'conversation-1',
          addedUserId: 'user-b',
          actorId: 'user-a',
          state: 'JOINING',
        },
      };

      await handleEvent(service, event);

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          recipientId: 'user-b',
          actorId: 'user-a',
          type: 'GROUP_ADDED',
          entityType: 'CONVERSATION',
          entityId: 'conversation-1',
        },
        transactionMock,
      );
    });

    /**
     * A malformed payload must fail loudly rather than silently reading
     * `undefined` fields.
     */
    it('throws on a malformed chat.participant.added payload', async () => {
      claimMock.mockResolvedValue(true);

      const event: TestKafkaDomainEvent = {
        eventId: 'participant-event-bad',
        type: 'chat.participant.added',
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateId: 'conversation-1',
        payload: {
          conversationId: 'conversation-1',
          addedUserId: 'user-b',
          actorId: 'user-a',
          state: 'SOMETHING_ELSE',
        },
      };

      await expect(handleEvent(service, event)).rejects.toThrow(
        /Malformed chat\.participant\.added payload/,
      );
      expect(createNotificationMock).not.toHaveBeenCalled();
    });
  });
});
