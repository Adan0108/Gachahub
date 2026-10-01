import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import {
  NotificationEntityType,
  NotificationType,
  PrismaClient,
} from '../src/generated/prisma/client';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

const ORIGIN = BASE_URL;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
});

const userA = {
  name: 'Notification Test User A',
  email: 'notification-test-a@example.com',
  password: 'Password123!',
};

const userB = {
  name: 'Notification Test User B',
  email: 'notification-test-b@example.com',
  password: 'Password123!',
};

type LoginResponse = {
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type NotificationResponse = {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  readAt: string | null;
};

type NotificationListResponse = {
  items: NotificationResponse[];
  nextCursor: string | null;
  hasMore: boolean;
};

type UnreadCountResponse = {
  count: number;
};

type MarkAllReadResponse = {
  updatedCount: number;
  readAt: string;
};

function logStep(message: string) {
  console.log(`\n=== ${message} ===`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();

  return data as T;
}

function getCookie(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const cookies = headers.getSetCookie?.();

  if (cookies && cookies.length > 0) {
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  }

  const setCookie = response.headers.get('set-cookie');

  if (!setCookie) {
    throw new Error('Better Auth did not return a session cookie');
  }

  return setCookie
    .split(',')
    .map((cookie) => cookie.split(';')[0].trim())
    .join('; ');
}

async function signup(user: { name: string; email: string; password: string }) {
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    },
    body: JSON.stringify(user),
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();

  throw new Error(`Signup failed: ${response.status} ${text}`);
}

async function login(email: string, password: string) {
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Login failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = await readJson<LoginResponse>(response);

  return {
    user: body.user,
    cookie: getCookie(response),
  };
}

async function authenticatedFetch(
  path: string,
  cookie: string,
  options: RequestInit = {},
) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: cookie,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [userA.email, userB.email],
      },
    },
    select: {
      id: true,
    },
  });

  const ids = users.map((user) => user.id);

  if (ids.length === 0) {
    return;
  }

  await prisma.notification.deleteMany({
    where: {
      OR: [
        {
          recipientId: {
            in: ids,
          },
        },
        {
          actorId: {
            in: ids,
          },
        },
      ],
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: {
        in: ids,
      },
    },
  });
}

async function run() {
  console.log(`Notification HTTP test running against ${BASE_URL}`);

  try {
    logStep('Cleanup previous test data');

    await cleanup();

    console.log('✓ Previous test data removed');

    logStep('Create test users');

    await signup(userA);
    await signup(userB);

    console.log('✓ User A created');
    console.log('✓ User B created');

    logStep('Login users through Better Auth');

    const sessionA = await login(userA.email, userA.password);

    const sessionB = await login(userB.email, userB.password);

    const userAId = sessionA.user.id;
    const userBId = sessionB.user.id;

    console.log(`✓ User A: ${userAId}`);
    console.log(`✓ User B: ${userBId}`);

    logStep('Seed notifications');

    const notification1 = await prisma.notification.create({
      data: {
        recipientId: userAId,
        actorId: userBId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId: 'test-post-1',
      },
    });

    await prisma.notification.create({
      data: {
        recipientId: userAId,
        actorId: userBId,
        type: NotificationType.POST_COMMENTED,
        entityType: NotificationEntityType.COMMENT,
        entityId: 'test-comment-1',
      },
    });

    await prisma.notification.create({
      data: {
        recipientId: userBId,
        actorId: userAId,
        type: NotificationType.USER_FOLLOWED,
        entityType: NotificationEntityType.USER,
        entityId: userAId,
      },
    });

    console.log('✓ 3 notifications created');
    console.log('  - 2 notifications belong to User A');
    console.log('  - 1 notification belongs to User B');

    logStep('GET /notifications as User A');

    const listResponse = await authenticatedFetch(
      '/notifications',
      sessionA.cookie,
    );

    assert(
      listResponse.status === 200,
      `Expected 200 but received ${listResponse.status}`,
    );

    const list = await readJson<NotificationListResponse>(listResponse);

    console.log(list);

    assert(
      list.items.length === 2,
      `User A should have 2 notifications, got ${list.items.length}`,
    );

    assert(
      list.items.every((item) => item.recipientId === userAId),
      'User A received another user notification',
    );

    console.log('✓ Notification list correct');

    logStep('GET /notifications/unread-count');

    const countResponse = await authenticatedFetch(
      '/notifications/unread-count',
      sessionA.cookie,
    );

    assert(
      countResponse.status === 200,
      `Expected 200 but received ${countResponse.status}`,
    );

    const count = await readJson<UnreadCountResponse>(countResponse);

    console.log(count);

    assert(count.count === 2, `Expected unread count 2, got ${count.count}`);

    console.log('✓ Unread count correct');

    logStep('PATCH one notification as read');

    const readResponse = await authenticatedFetch(
      `/notifications/${notification1.id}/read`,
      sessionA.cookie,
      {
        method: 'PATCH',
      },
    );

    assert(
      readResponse.status === 200,
      `Expected 200 but received ${readResponse.status}`,
    );

    const marked = await readJson<NotificationResponse>(readResponse);

    assert(marked.readAt !== null, 'Notification readAt should not be null');

    console.log(`✓ Notification ${notification1.id} marked as read`);

    logStep('Verify unread count dropped to 1');

    const countAfterReadResponse = await authenticatedFetch(
      '/notifications/unread-count',
      sessionA.cookie,
    );

    assert(
      countAfterReadResponse.status === 200,
      `Expected 200 but received ${countAfterReadResponse.status}`,
    );

    const countAfterRead = await readJson<UnreadCountResponse>(
      countAfterReadResponse,
    );

    assert(
      countAfterRead.count === 1,
      `Expected unread count 1, got ${countAfterRead.count}`,
    );

    console.log('✓ Unread count = 1');

    logStep('Security: User B tries to mark User A notification');

    const forbiddenResponse = await authenticatedFetch(
      `/notifications/${notification1.id}/read`,
      sessionB.cookie,
      {
        method: 'PATCH',
      },
    );

    assert(
      forbiddenResponse.status === 404,
      `Expected 404 but received ${forbiddenResponse.status}`,
    );

    console.log('✓ User B cannot access User A notification');

    logStep('PATCH /notifications/read-all');

    const markAllResponse = await authenticatedFetch(
      '/notifications/read-all',
      sessionA.cookie,
      {
        method: 'PATCH',
      },
    );

    assert(
      markAllResponse.status === 200,
      `Expected 200 but received ${markAllResponse.status}`,
    );

    const markAll = await readJson<MarkAllReadResponse>(markAllResponse);

    console.log(markAll);

    assert(
      markAll.updatedCount === 1,
      `Expected 1 remaining notification, got ${markAll.updatedCount}`,
    );

    console.log('✓ Remaining notification marked as read');

    logStep('Verify final unread count');

    const finalCountResponse = await authenticatedFetch(
      '/notifications/unread-count',
      sessionA.cookie,
    );

    assert(
      finalCountResponse.status === 200,
      `Expected 200 but received ${finalCountResponse.status}`,
    );

    const finalCount = await readJson<UnreadCountResponse>(finalCountResponse);

    assert(
      finalCount.count === 0,
      `Expected final unread count 0, got ${finalCount.count}`,
    );

    console.log('✓ Final unread count = 0');

    logStep('Unauthenticated request');

    const unauthenticatedResponse = await fetch(`${BASE_URL}/notifications`, {
      headers: {
        Origin: ORIGIN,
      },
    });

    assert(
      unauthenticatedResponse.status === 401,
      `Expected 401 but received ${unauthenticatedResponse.status}`,
    );

    console.log('✓ Unauthenticated access rejected');

    console.log('');
    console.log('================================');
    console.log('✅ ALL NOTIFICATION TESTS PASSED');
    console.log('================================');
    console.log('');
  } finally {
    logStep('Cleanup');

    await cleanup();

    await prisma.$disconnect();

    console.log('✓ Test data removed');
  }
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('\n❌ TEST FAILED');
    console.error(error.message);
  } else {
    console.error('\n❌ TEST FAILED');
    console.error(error);
  }

  process.exitCode = 1;
});
