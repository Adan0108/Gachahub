import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Settling message notifications (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let repository: NotificationRepository;
  const token = randomUUID();
  const id = (name: string) => `ns-${name}-${token}`;
  const me = id('me');
  const bo = id('bo');
  let conversationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, NotificationRepository],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    repository = app.get(NotificationRepository);

    await db.user.createMany({
      data: [me, bo].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
      })),
    });
    conversationId = (await db.chatConversation.create({ data: {} })).id;
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({ where: { id: conversationId } });
      await db.user.deleteMany({ where: { id: { in: [me, bo] } } });
    }
    await app?.close();
  });

  afterEach(async () => {
    await db.notification.deleteMany({ where: { recipientId: me } });
    await db.chatMessage.deleteMany({ where: { conversationId } });
  });

  /** A message from Bo to me, with my receipt and the notification about it. */
  async function incoming({
    readAt = null,
    status = 'SENT',
    type = 'MESSAGE_RECEIVED',
  }: {
    readAt?: Date | null;
    status?: 'SENT' | 'DELETED';
    type?: 'MESSAGE_RECEIVED' | 'MESSAGE_REPLIED';
  } = {}) {
    const message = await db.chatMessage.create({
      data: { conversationId, senderId: bo, ciphertext: 'x', status },
    });
    await db.chatMessageReceipt.create({
      data: { messageId: message.id, userId: me, readAt },
    });
    const notification = await db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type,
        entityType: 'MESSAGE',
        entityId: message.id,
      },
    });
    return { message, notification };
  }

  const readAtOf = async (notificationId: string) =>
    (await db.notification.findUniqueOrThrow({ where: { id: notificationId } }))
      .readAt;

  it('settles a notification whose message was read just before the notification was saved', async () => {
    const readAt = new Date(Date.now() - 5_000);
    const { notification } = await incoming({ readAt });

    const settled = await repository.settleMessageNotifications(me);

    expect(settled).toBe(1);
    expect(await readAtOf(notification.id)).toEqual(readAt);
    expect(await repository.countUnread(me)).toBe(0);
  });

  it('settles replies the same way', async () => {
    const { notification } = await incoming({
      readAt: new Date(),
      type: 'MESSAGE_REPLIED',
    });

    await repository.settleMessageNotifications(me);

    expect(await readAtOf(notification.id)).not.toBeNull();
  });

  it('leaves a notification for a message that is still unread', async () => {
    const { notification } = await incoming();

    const settled = await repository.settleMessageNotifications(me);

    expect(settled).toBe(0);
    expect(await readAtOf(notification.id)).toBeNull();
    expect(await repository.countUnread(me)).toBe(1);
  });

  it('settles a notification whose message was unsent', async () => {
    const { notification } = await incoming({ status: 'DELETED' });

    await repository.settleMessageNotifications(me);

    expect(await readAtOf(notification.id)).not.toBeNull();
  });

  it('settles a notification whose message no longer exists', async () => {
    const { message, notification } = await incoming();
    await db.chatMessage.delete({ where: { id: message.id } });

    await repository.settleMessageNotifications(me);

    expect(await readAtOf(notification.id)).not.toBeNull();
  });

  it('does not touch notifications that are not about messages, or are for someone else', async () => {
    const { message } = await incoming({ readAt: new Date() });
    const like = await db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: 'some-post',
      },
    });
    const others = await db.notification.create({
      data: {
        recipientId: bo,
        actorId: me,
        type: 'MESSAGE_RECEIVED',
        entityType: 'MESSAGE',
        entityId: message.id,
      },
    });

    await repository.settleMessageNotifications(me);

    expect(await readAtOf(like.id)).toBeNull();
    expect(await readAtOf(others.id)).toBeNull();
    await db.notification.deleteMany({ where: { id: others.id } });
  });
});
