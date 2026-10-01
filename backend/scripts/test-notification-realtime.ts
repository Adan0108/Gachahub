import 'dotenv/config';

import { randomUUID } from 'crypto';
import { Kafka, type Producer } from 'kafkajs';
import { io, type Socket } from 'socket.io-client';

import { KAFKA_TOPICS } from '../src/kafka/kafka-topics';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthSession {
  user: {
    id: string;
    email: string;
  };
  session: {
    id: string;
  };
}

interface NotificationPayload {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  entityType: string;
  entityId: string;
  readAt: string | null;
  createdAt: string;
}

interface LoginResult {
  cookie: string;
  session: AuthSession;
}

const BACKEND_URL = process.env.TEST_BACKEND_URL ?? 'http://localhost:3000';

const FRONTEND_ORIGIN =
  process.env.TEST_FRONTEND_ORIGIN ??
  process.env.FRONTEND_URL ??
  'http://localhost:3001';

const ACTOR_EMAIL = process.env.TEST_ACTOR_EMAIL;
const ACTOR_PASSWORD = process.env.TEST_ACTOR_PASSWORD;

const RECIPIENT_EMAIL = process.env.TEST_RECIPIENT_EMAIL;
const RECIPIENT_PASSWORD = process.env.TEST_RECIPIENT_PASSWORD;

const NOTIFICATION_CONSUMER = 'notifications';

const SOCKET_TIMEOUT_MS = 10_000;
const DUPLICATE_WAIT_MS = 3_000;

/**
 * Verifies that all environment variables required by the realtime
 * notification integration test are available.
 */
function validateEnvironment(): void {
  if (!ACTOR_EMAIL || !ACTOR_PASSWORD) {
    throw new Error('TEST_ACTOR_EMAIL and TEST_ACTOR_PASSWORD are required');
  }

  if (!RECIPIENT_EMAIL || !RECIPIENT_PASSWORD) {
    throw new Error(
      'TEST_RECIPIENT_EMAIL and TEST_RECIPIENT_PASSWORD are required',
    );
  }

  if (ACTOR_EMAIL === RECIPIENT_EMAIL) {
    throw new Error('Actor and recipient must be two different users');
  }
}

/**
 * Signs a user in through Better Auth and returns the authenticated
 * session cookie that will later be sent in the Socket.IO handshake.
 */
async function login(email: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${BACKEND_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: FRONTEND_ORIGIN,
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`Login failed for ${email}: ${response.status} ${body}`);
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length === 0) {
    throw new Error(
      `Login succeeded for ${email}, but no session cookie was returned`,
    );
  }

  /*
   * Socket.IO only needs the cookie name/value pairs.
   * Attributes such as Path, SameSite and HttpOnly are not sent back
   * in the Cookie request header.
   */
  const cookie = cookies.map((item) => item.split(';')[0]).join('; ');

  const sessionResponse = await fetch(`${BACKEND_URL}/api/auth/get-session`, {
    headers: {
      Cookie: cookie,
      Origin: FRONTEND_ORIGIN,
    },
  });

  if (!sessionResponse.ok) {
    throw new Error(`Failed to read Better Auth session for ${email}`);
  }

  const session = (await sessionResponse.json()) as AuthSession | null;

  if (!session?.user?.id || !session.session?.id) {
    throw new Error(`No authenticated session returned for ${email}`);
  }

  return {
    cookie,
    session,
  };
}

/**
 * Connects an authenticated Socket.IO client using the same Better Auth
 * cookie that the existing WebsocketGateway validates during handshake.
 */
function connectSocket(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: SOCKET_TIMEOUT_MS,
      extraHeaders: {
        Cookie: cookie,
        Origin: FRONTEND_ORIGIN,
      },
    });

    const timeout = setTimeout(() => {
      socket.disconnect();

      reject(new Error(`Socket did not connect within ${SOCKET_TIMEOUT_MS}ms`));
    }, SOCKET_TIMEOUT_MS);

    socket.once('connect', () => {
      clearTimeout(timeout);

      console.log(`Socket connected: ${socket.id}`);

      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);

      socket.disconnect();

      reject(new Error(`Socket connection failed: ${error.message}`));
    });

    socket.once('session:revoked', () => {
      clearTimeout(timeout);

      socket.disconnect();

      reject(new Error('Socket authentication failed: session was revoked'));
    });
  });
}

/**
 * Creates a Kafka producer using the same broker configuration as
 * the backend.
 */
async function createKafkaProducer(): Promise<Producer> {
  const brokers = process.env.KAFKA_BROKERS?.split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (!brokers || brokers.length === 0) {
    throw new Error('KAFKA_BROKERS is missing');
  }

  const kafka = new Kafka({
    clientId: 'gachahub-notification-realtime-test',
    brokers,
  });

  const producer = kafka.producer();

  await producer.connect();

  return producer;
}

/**
 * Publishes a post.liked domain event directly to Kafka.
 *
 * This intentionally bypasses the outbox because this script is testing
 * the Kafka -> NotificationConsumer -> DB -> Socket.IO path.
 */
async function publishPostLikedEvent(
  producer: Producer,
  event: {
    eventId: string;
    postId: string;
    actorId: string;
    postAuthorId: string;
  },
): Promise<void> {
  const domainEvent = {
    eventId: event.eventId,
    type: 'post.liked',
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: event.postId,
    payload: {
      postId: event.postId,
      postAuthorId: event.postAuthorId,
      actorId: event.actorId,
    },
  };

  await producer.send({
    topic: KAFKA_TOPICS.POSTS,
    messages: [
      {
        key: event.postId,
        value: JSON.stringify(domainEvent),
      },
    ],
  });
}

/**
 * Waits until the connected recipient receives notification:new.
 */
function waitForNotification(socket: Socket): Promise<NotificationPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('notification:new', onNotification);

      reject(
        new Error(
          `notification:new was not received within ${SOCKET_TIMEOUT_MS}ms`,
        ),
      );
    }, SOCKET_TIMEOUT_MS);

    const onNotification = (notification: NotificationPayload): void => {
      clearTimeout(timeout);

      socket.off('notification:new', onNotification);

      resolve(notification);
    };

    socket.on('notification:new', onNotification);
  });
}

/**
 * Waits for a short period and verifies that the duplicate Kafka event
 * does not produce another realtime notification.
 */
function assertNoDuplicateNotification(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onNotification = (notification: NotificationPayload): void => {
      clearTimeout(timeout);

      socket.off('notification:new', onNotification);

      reject(
        new Error(
          `Duplicate realtime notification received: ${notification.id}`,
        ),
      );
    };

    const timeout = setTimeout(() => {
      socket.off('notification:new', onNotification);

      resolve();
    }, DUPLICATE_WAIT_MS);

    socket.on('notification:new', onNotification);
  });
}

/**
 * Runs the realtime notification integration test against the real
 * Better Auth, Kafka, PostgreSQL and Socket.IO infrastructure.
 */
async function main(): Promise<void> {
  validateEnvironment();

  const prisma = new PrismaService();

  let producer: Producer | undefined;
  let recipientSocket: Socket | undefined;

  const eventId = `realtime-test-${randomUUID()}`;
  const postId = `realtime-post-${randomUUID()}`;

  let actorId: string | undefined;
  let recipientId: string | undefined;

  try {
    await prisma.$connect();

    console.log('\n=== LOGIN TEST USERS ===');

    const actor = await login(ACTOR_EMAIL!, ACTOR_PASSWORD!);

    const recipient = await login(RECIPIENT_EMAIL!, RECIPIENT_PASSWORD!);

    actorId = actor.session.user.id;
    recipientId = recipient.session.user.id;

    console.log({
      actorId,
      recipientId,
    });

    console.log('\n=== CONNECT RECIPIENT SOCKET ===');

    recipientSocket = await connectSocket(recipient.cookie);

    producer = await createKafkaProducer();

    /*
     * -------------------------------------------------------------
     */

    console.log('\n=== TEST 1: new event creates realtime notification ===');

    const notificationPromise = waitForNotification(recipientSocket);

    await publishPostLikedEvent(producer, {
      eventId,
      postId,
      actorId,
      postAuthorId: recipientId,
    });

    const notification = await notificationPromise;

    console.log('Received notification:', notification);

    if (notification.recipientId !== recipientId) {
      throw new Error(
        `Wrong recipient: expected ${recipientId}, received ${notification.recipientId}`,
      );
    }

    if (notification.actorId !== actorId) {
      throw new Error(
        `Wrong actor: expected ${actorId}, received ${notification.actorId}`,
      );
    }

    if (notification.type !== 'POST_LIKED') {
      throw new Error(`Wrong notification type: ${notification.type}`);
    }

    if (notification.entityType !== 'POST') {
      throw new Error(`Wrong entity type: ${notification.entityType}`);
    }

    if (notification.entityId !== postId) {
      throw new Error(`Wrong entity id: ${notification.entityId}`);
    }

    const processedCount = await prisma.processedEvent.count({
      where: {
        eventId,
        consumer: NOTIFICATION_CONSUMER,
      },
    });

    const notificationCount = await prisma.notification.count({
      where: {
        recipientId,
        actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: postId,
      },
    });

    console.log({
      processedEvents: processedCount,
      notifications: notificationCount,
    });

    if (processedCount !== 1 || notificationCount !== 1) {
      throw new Error(
        'Database state is incorrect after realtime notification',
      );
    }

    console.log('✅ TEST 1 passed: realtime notification received');

    /*
     * -------------------------------------------------------------
     */

    console.log('\n=== TEST 2: duplicate event does not emit again ===');

    const noDuplicatePromise = assertNoDuplicateNotification(recipientSocket);

    /*
     * Publish exactly the same eventId again.
     */
    await publishPostLikedEvent(producer, {
      eventId,
      postId,
      actorId,
      postAuthorId: recipientId,
    });

    await noDuplicatePromise;

    const duplicateProcessedCount = await prisma.processedEvent.count({
      where: {
        eventId,
        consumer: NOTIFICATION_CONSUMER,
      },
    });

    const duplicateNotificationCount = await prisma.notification.count({
      where: {
        recipientId,
        actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: postId,
      },
    });

    console.log({
      processedEvents: duplicateProcessedCount,
      notifications: duplicateNotificationCount,
    });

    if (duplicateProcessedCount !== 1 || duplicateNotificationCount !== 1) {
      throw new Error('Duplicate event changed database state');
    }

    console.log('✅ TEST 2 passed: duplicate event was ignored');

    console.log('\n🎉 Notification realtime integration test passed');
  } finally {
    recipientSocket?.disconnect();

    if (producer) {
      await producer.disconnect();
    }

    /*
     * Remove only records created by this test.
     * Existing test users are intentionally preserved.
     */
    await prisma.processedEvent.deleteMany({
      where: {
        eventId,
        consumer: NOTIFICATION_CONSUMER,
      },
    });

    if (actorId && recipientId) {
      await prisma.notification.deleteMany({
        where: {
          recipientId,
          actorId,
          type: 'POST_LIKED',
          entityType: 'POST',
          entityId: postId,
        },
      });
    }

    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('\n❌ Notification realtime integration test failed');

  if (error instanceof Error) {
    console.error(error.stack);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
