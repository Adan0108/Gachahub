jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    OptionalAuth: () => common.SetMetadata('OPTIONAL', true),
    Session: () =>
      common.createParamDecorator(
        (_: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest().session,
      )(),
  };
});
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kafka, type EachMessagePayload } from 'kafkajs';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PostsController } from '../src/posts/posts.controller';
import { PostsService } from '../src/posts/posts.service';
import { PostsRepository } from '../src/posts/posts.repository';
import { CommentsController } from '../src/comments/comments.controller';
import { CommentsService } from '../src/comments/comments.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { PostVisibilityService } from '../src/post-visibility/post-visibility.service';
import { FollowsService } from '../src/follows/follows.service';
import { MediaService } from '../src/media/media.service';
import { UserInterestService } from '../src/recommendation/user-interest.service';
import { MentionsService } from '../src/mentions/mentions.service';
import { EventPublisherPort } from '../src/domain-events/event-publisher.port';
import { OutboxEventPublisher } from '../src/outbox/outbox-event.publisher';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import {
  KafkaProducerService,
  type KafkaDomainEvent,
} from '../src/kafka/kafka-producer.service';
import { resolveDomainEventTopic } from '../src/kafka/kafka-topics';
import { NotificationController } from '../src/notifications/notification.controller';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { NotificationConsumerService } from '../src/notifications/notification-consumer.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import {
  SocketNotificationDeliveryService,
  type NotificationSocketPayload,
} from '../src/notifications/realtime/socket-notification-delivery.service';
import { SocketRegistry } from '../src/websocket/socket-registry.service';
import { userRoom } from '../src/websocket/socket.util';
import type {
  OutboxEvent,
  NotificationType,
} from '../src/generated/prisma/client';

// Infrastructure suite: requires real PostgreSQL + the configured Kafka broker.
// Kafka records persist; all records use unique IDs, and the unique test consumer
// group is removed afterwards. No global outbox polling or shared offsets.
// Sessions and Socket.IO room membership are injected (not gateway/login E2E).
// Production producer, consumer, dispatcher, DB transaction and socket delivery
// run unmocked except the explicitly injected transport/storage failures below.
describe('Personal posts: real Kafka/outbox/notification/socket pipeline', () => {
  jest.setTimeout(180_000);
  const prefix = `personal-pipeline-${randomUUID()}`;
  const author = `${prefix}-author`;
  const actor = `${prefix}-actor`;
  const mentioned = `${prefix}-mentioned`;
  const handle = `p${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  const groupId = prefix;
  const oldGroup = process.env.KAFKA_NOTIFICATION_GROUP_ID;
  const aggregates = new Set<string>();
  const handled: string[] = [];
  const received: Array<{ event: KafkaDomainEvent; wire: EachMessagePayload }> =
    [];
  const pushes: NotificationSocketPayload[] = [];
  const commitChecks: Promise<unknown>[] = [];
  const clients: Socket[] = [];
  let app: INestApplication;
  let db: PrismaService;
  let sockets: Server;
  let producer: KafkaProducerService;
  let consumer: NotificationConsumerService;
  let dispatcher: OutboxDispatcherService;
  let outbox: OutboxRepository;
  let transientEvent: string | undefined;
  let failed = false;
  let releaseRetry: (() => void) | undefined;
  let retryGate: Promise<void> | undefined;

  const http = () => request(app.getHttpServer());
  async function until(
    probe: () => Promise<boolean> | boolean,
    label: string,
    ms = 90_000,
  ) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function post(content = 'Personal pipeline fixture') {
    const response = await http().post('/posts').send({ content }).expect(201);
    aggregates.add(response.body.id);
    expect(
      await db.post.findUniqueOrThrow({ where: { id: response.body.id } }),
    ).toMatchObject({ gameId: null, type: null, categoryId: null });
    return response.body.id as string;
  }
  async function like() {
    const id = await post();
    await http()
      .post(`/posts/${id}/like`)
      .set('x-test-user', actor)
      .expect(201);
    return eventFor(id, 'post.liked');
  }
  async function eventFor(aggregateId: string, type: string) {
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId, type },
    });
    expect(event).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
      version: 1,
    });
    const payload = event.payload as Record<string, unknown>;
    for (const field of ['gameId', 'game', 'type', 'categoryId'])
      expect(payload).not.toHaveProperty(field);
    return event;
  }
  const envelope = (event: OutboxEvent): KafkaDomainEvent => ({
    eventId: event.id,
    type: event.type as KafkaDomainEvent['type'],
    version: event.version,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  });
  async function dispatch(event: OutboxEvent) {
    // Use the production claim/send/ack/retry path, restricted to this fixture.
    await dispatcher['processEvent'](event);
  }
  async function delivered(
    event: OutboxEvent,
    type: NotificationType,
    recipientId: string,
    entityId = event.aggregateId,
  ) {
    await until(() => handled.includes(event.id), 'Kafka record received');
    await until(
      async () =>
        (await db.processedEvent.count({
          where: { eventId: event.id, consumer: 'notifications' },
        })) === 1,
      'ProcessedEvent committed',
    );
    const notification = await db.notification.findFirstOrThrow({
      where: { recipientId, type, entityId },
    });
    await until(
      () => pushes.some((entry) => entry.id === notification.id),
      'Socket.IO client received notification',
    );
    const wire = received.find((entry) => entry.event.eventId === event.id)!;
    expect(wire.event).toEqual(envelope(event));
    expect(wire.wire.topic).toBe(resolveDomainEventTopic(wire.event.type));
    expect(wire.wire.message.key?.toString()).toBe(event.aggregateId);
    expect(wire.wire.message.headers?.eventId?.toString()).toBe(event.id);
    expect(wire.wire.message.headers?.eventType?.toString()).toBe(event.type);
    expect(wire.wire.message.headers?.eventVersion?.toString()).toBe('1');
    expect(
      await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ status: 'PUBLISHED', processingAt: null });
    expect(pushes.find((entry) => entry.id === notification.id)).toMatchObject({
      id: notification.id,
      type,
      entityId,
      recipientId,
    });
    await Promise.all(commitChecks);
    return notification;
  }

  beforeAll(async () => {
    process.env.KAFKA_NOTIFICATION_GROUP_ID = groupId;
    const module = await Test.createTestingModule({
      controllers: [
        PostsController,
        CommentsController,
        NotificationController,
      ],
      providers: [
        PrismaService,
        PostsService,
        PostsRepository,
        CommentsService,
        CommentsRepository,
        PostVisibilityService,
        MentionsService,
        OutboxRepository,
        OutboxEventPublisher,
        NotificationRepository,
        NotificationService,
        ProcessedEventRepository,
        SocketRegistry,
        SocketNotificationDeliveryService,
        { provide: EventPublisherPort, useExisting: OutboxEventPublisher },
        {
          provide: MediaService,
          useValue: { resolveAttachableMedia: async () => [] },
        },
        {
          provide: FollowsService,
          useValue: { isFollowing: async () => ({ following: false }) },
        },
        {
          provide: UserInterestService,
          useValue: { recordPostInteraction: async () => {} },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.session = { user: { id: req.headers['x-test-user'] ?? author } };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    sockets = new Server(app.getHttpServer());
    app.get(SocketRegistry).server = sockets;
    sockets.on('connection', (socket) => {
      // Test-only identity/room attachment, not the production auth gateway.
      void socket.join(userRoom(socket.handshake.auth.userId));
      socket.emit('fixture:ready');
    });
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    await db.user.createMany({
      data: [author, actor, mentioned].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        ...(id === mentioned ? { username: handle } : {}),
      })),
    });
    const delivery = app.get(SocketNotificationDeliveryService);
    const publish = delivery.publish.bind(delivery);
    jest.spyOn(delivery, 'publish').mockImplementation((notification) => {
      // A separate DB read begins at the delivery boundary: the row must
      // already be visible outside the consumer transaction.
      commitChecks.push(
        db.notification
          .findUnique({ where: { id: notification.id } })
          .then((row) => expect(row).not.toBeNull()),
      );
      publish(notification);
    });
    const port = app.getHttpServer().address().port;
    for (const id of [author, actor, mentioned]) {
      const client = io(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        auth: { userId: id },
        forceNew: true,
        reconnection: false,
      });
      clients.push(client);
      client.on('notification:new', (notification) =>
        pushes.push(notification),
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Socket connection timed out')),
          10_000,
        );
        client.once('fixture:ready', () => {
          clearTimeout(timer);
          resolve();
        });
        client.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }
    outbox = app.get(OutboxRepository);
    producer = new KafkaProducerService();
    await producer.onModuleInit();
    dispatcher = new OutboxDispatcherService(outbox, producer);
    // Never start the dispatcher's global polling timer.
    consumer = new NotificationConsumerService(
      app.get(NotificationService),
      app.get(ProcessedEventRepository),
      db,
      delivery,
    );
    const handleMessage = consumer['handleMessage'].bind(consumer);
    jest
      .spyOn(
        consumer as unknown as {
          handleMessage(payload: EachMessagePayload): Promise<void>;
        },
        'handleMessage',
      )
      .mockImplementation(async (wire) => {
        const event = JSON.parse(
          wire.message.value!.toString(),
        ) as KafkaDomainEvent;
        // Unique group offsets never affect the development consumer, and
        // unrelated broker traffic must not write notifications in this test.
        if (!aggregates.has(event.aggregateId)) return;
        received.push({ event, wire });
        if (event.eventId === transientEvent && failed) await retryGate;
        try {
          await handleMessage(wire);
          handled.push(event.eventId);
        } catch (error) {
          if (event.eventId === transientEvent) failed = true;
          throw error;
        }
      });
    await consumer.onModuleInit();
    await until(
      () =>
        consumer['consumer']
          .describeGroup()
          .then((group) => group.state === 'Stable'),
      'Kafka group assignment',
    );
  });

  afterAll(async () => {
    releaseRetry?.();
    for (const client of clients) client.disconnect();
    try {
      await consumer?.onModuleDestroy();
      await producer?.onModuleDestroy();
      if (db) {
        const events = await db.outboxEvent.findMany({
          where: { aggregateId: { in: [...aggregates] } },
          select: { id: true },
        });
        await db.processedEvent.deleteMany({
          where: { eventId: { in: events.map((event) => event.id) } },
        });
        await db.outboxEvent.deleteMany({
          where: { aggregateId: { in: [...aggregates] } },
        });
        await db.mention.deleteMany({
          where: { entityId: { in: [...aggregates] } },
        });
        await db.user.deleteMany({
          where: { id: { in: [author, actor, mentioned] } },
        });
      }
      const admin = new Kafka({
        clientId: prefix,
        brokers: process.env
          .KAFKA_BROKERS!.split(',')
          .map((broker) => broker.trim()),
      }).admin();
      try {
        await admin.connect();
        await admin.deleteGroups([groupId]);
      } finally {
        await admin.disconnect();
      }
    } finally {
      await sockets?.close();
      await app?.close();
      if (oldGroup === undefined)
        delete process.env.KAFKA_NOTIFICATION_GROUP_ID;
      else process.env.KAFKA_NOTIFICATION_GROUP_ID = oldGroup;
    }
  });

  it('post liked: API -> durable outbox -> posts topic -> author notification -> real socket', async () => {
    const event = await like();
    await http()
      .post(`/posts/${event.aggregateId}/like`)
      .set('x-test-user', actor)
      .expect(201);
    expect(
      await db.outboxEvent.count({ where: { aggregateId: event.aggregateId } }),
    ).toBe(1);
    expect(event.payload).toEqual({
      postId: event.aggregateId,
      postAuthorId: author,
      actorId: actor,
    });
    await dispatch(event);
    await delivered(event, 'POST_LIKED', author);
  });

  it('post commented: posts topic -> post author, with safe comment/post ID mapping', async () => {
    const id = await post();
    const comment = await http()
      .post(`/posts/${id}/comments`)
      .set('x-test-user', actor)
      .send({ content: 'A comment' })
      .expect(201);
    aggregates.add(comment.body.id);
    const event = await eventFor(comment.body.id, 'comment.created');
    expect(event.payload).toEqual({
      postId: id,
      commentId: comment.body.id,
      postAuthorId: author,
      actorId: actor,
      parentCommentId: null,
      parentCommentAuthorId: null,
    });
    await dispatch(event);
    await delivered(event, 'POST_COMMENTED', author);
    const listing = await http().get('/notifications?limit=50').expect(200);
    expect(listing.body.items).toContainEqual(
      expect.objectContaining({ entityId: comment.body.id, postId: id }),
    );
  });

  it('comment replied: notifies the parent author, preserving the existing single-recipient rule', async () => {
    const id = await post();
    const root = await http()
      .post(`/posts/${id}/comments`)
      .set('x-test-user', actor)
      .send({ content: 'Parent' })
      .expect(201);
    aggregates.add(root.body.id);
    const reply = await http()
      .post(`/comments/${root.body.id}/replies`)
      .set('x-test-user', mentioned)
      .send({ content: 'Reply' })
      .expect(201);
    aggregates.add(reply.body.id);
    const event = await eventFor(reply.body.id, 'comment.created');
    expect(event.payload).toMatchObject({
      parentCommentId: root.body.id,
      parentCommentAuthorId: actor,
      actorId: mentioned,
      postId: id,
    });
    await dispatch(event);
    await delivered(event, 'COMMENT_REPLIED', actor);
    expect(
      await db.notification.count({ where: { entityId: reply.body.id } }),
    ).toBe(1);
  });

  it.each(['POST', 'COMMENT'] as const)(
    'mention in personal %s: social topic -> mentioned user -> socket',
    async (entityType) => {
      const id = await post(
        entityType === 'POST' ? `Hello @${handle}` : 'Comment mention fixture',
      );
      let entityId = id;
      if (entityType === 'COMMENT') {
        const comment = await http()
          .post(`/posts/${id}/comments`)
          .set('x-test-user', actor)
          .send({ content: `Hello @${handle}` })
          .expect(201);
        entityId = comment.body.id;
        aggregates.add(entityId);
      }
      expect(
        await db.mention.count({
          where: { entityType, entityId, userId: mentioned },
        }),
      ).toBe(1);
      const event = await eventFor(entityId, 'user.mentioned');
      expect(event.payload).toEqual({
        actorId: entityType === 'POST' ? author : actor,
        targetUserId: mentioned,
        entityType,
        entityId,
      });
      await dispatch(event);
      await delivered(event, 'USER_MENTIONED', mentioned);
      const listing = await http()
        .get('/notifications?limit=50')
        .set('x-test-user', mentioned)
        .expect(200);
      expect(listing.body.items).toContainEqual(
        expect.objectContaining({
          entityType,
          entityId,
          postId: entityType === 'COMMENT' ? id : null,
        }),
      );
    },
  );

  it('same event ID redelivered over Kafka produces one claim, one notification and one socket push', async () => {
    const event = await like();
    await dispatch(event);
    const notification = await delivered(event, 'POST_LIKED', author);
    await producer.publish(envelope(event));
    await producer.publish(envelope(event));
    await until(
      () => handled.filter((id) => id === event.id).length === 3,
      'three real Kafka deliveries',
    );
    expect(
      await db.processedEvent.count({ where: { eventId: event.id } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { entityId: event.aggregateId } }),
    ).toBe(1);
    expect(pushes.filter((entry) => entry.id === notification.id)).toHaveLength(
      1,
    );
  });

  it('distinct event IDs with the same fact use notification dedupe; existing socket re-emission is preserved', async () => {
    const first = await like();
    await dispatch(first);
    const notification = await delivered(first, 'POST_LIKED', author);
    const duplicate = { ...first, id: randomUUID() };
    await db.outboxEvent.create({
      data: {
        id: duplicate.id,
        type: duplicate.type,
        version: 1,
        occurredAt: duplicate.occurredAt,
        aggregateId: duplicate.aggregateId,
        payload: duplicate.payload!,
      },
    });
    await dispatch(duplicate);
    await delivered(duplicate, 'POST_LIKED', author);
    await until(
      () => pushes.filter((entry) => entry.id === notification.id).length === 2,
      'deduped notification socket re-emission',
    );
    expect(
      await db.processedEvent.count({
        where: { eventId: { in: [first.id, duplicate.id] } },
      }),
    ).toBe(2);
    expect(
      await db.notification.count({ where: { entityId: first.aggregateId } }),
    ).toBe(1);
  });

  it('producer failure preserves the event for retry, then real Kafka delivery succeeds', async () => {
    const event = await like();
    const start = Date.now();
    jest
      .spyOn(producer, 'publish')
      .mockRejectedValueOnce(new Error('Injected Kafka send failure'));
    await dispatch(event);
    const pending = await db.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(pending).toMatchObject({
      status: 'PENDING',
      attemptCount: 1,
      processingAt: null,
      publishedAt: null,
      lastError: 'Injected Kafka send failure',
    });
    expect(pending.availableAt.getTime()).toBeGreaterThanOrEqual(start + 1_000);
    expect(
      await db.processedEvent.count({ where: { eventId: event.id } }),
    ).toBe(0);
    await db.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    expect(await outbox.claim(event.id)).toBe(false);
    await db.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(0) },
    });
    await dispatch(
      await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    );
    await delivered(event, 'POST_LIKED', author);
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .attemptCount,
    ).toBe(2);
  });

  it('publish-ack storage failure safely republishes the same ID without another notification/socket', async () => {
    const event = await like();
    jest
      .spyOn(outbox, 'markPublished')
      .mockRejectedValueOnce(new Error('Injected published-state failure'));
    await dispatch(event);
    await until(
      async () =>
        (await db.processedEvent.count({ where: { eventId: event.id } })) === 1,
      'first delivery committed',
    );
    await db.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(0) },
    });
    await dispatch(
      await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    );
    const notification = await delivered(event, 'POST_LIKED', author);
    await until(
      () => handled.filter((id) => id === event.id).length === 2,
      'retry Kafka delivery',
    );
    expect(
      await db.notification.count({ where: { entityId: event.aggregateId } }),
    ).toBe(1);
    expect(pushes.filter((entry) => entry.id === notification.id)).toHaveLength(
      1,
    );
  });

  it('exhausted outbox retries retain a FAILED record and publish no notification', async () => {
    const event = await like();
    await db.outboxEvent.update({
      where: { id: event.id },
      data: { attemptCount: 7 },
    });
    jest
      .spyOn(producer, 'publish')
      .mockRejectedValueOnce(new Error('Injected final send failure'));
    await dispatch({ ...event, attemptCount: 7 });
    expect(
      await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({
      status: 'FAILED',
      attemptCount: 8,
      processingAt: null,
      lastError: 'Injected final send failure',
    });
    expect(
      await db.notification.count({ where: { entityId: event.aggregateId } }),
    ).toBe(0);
    expect(
      await db.processedEvent.count({ where: { eventId: event.id } }),
    ).toBe(0);
    expect(await outbox.claim(event.id)).toBe(false);
  });

  it('consumer DB failure rolls back its claim and Kafka redelivers the unacknowledged event', async () => {
    const event = await like();
    transientEvent = event.id;
    failed = false;
    retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    jest
      .spyOn(app.get(NotificationRepository), 'create')
      .mockRejectedValueOnce(
        new Error('Injected notification persistence failure'),
      );
    try {
      await dispatch(event);
      await until(() => failed, 'consumer failure');
      expect(
        await db.processedEvent.count({ where: { eventId: event.id } }),
      ).toBe(0);
      expect(
        await db.notification.count({ where: { entityId: event.aggregateId } }),
      ).toBe(0);
      expect(pushes.some((entry) => entry.entityId === event.aggregateId)).toBe(
        false,
      );
      releaseRetry!();
      await delivered(event, 'POST_LIKED', author);
      expect(
        received.filter((entry) => entry.event.eventId === event.id).length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      releaseRetry?.();
      transientEvent = undefined;
    }
  });
});
