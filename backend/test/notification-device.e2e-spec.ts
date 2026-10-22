import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Notifications for messages a new device cannot read (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let repository: NotificationRepository;
  const token = randomUUID();
  const id = (name: string) => `nd-${name}-${token}`;
  const me = id('me');
  const bo = id('bo');
  const deviceId = id('device');
  const sessionId = id('session');
  let conversationId: string;
  const deviceStart = new Date('2026-10-10T12:00:00Z');

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
    await db.chatDevice.create({
      data: {
        id: deviceId,
        userId: me,
        signaturePublicKey: Buffer.from('k'),
        ciphersuite: 'test',
        createdAt: deviceStart,
      },
    });
    await db.session.create({
      data: {
        id: sessionId,
        token: `tok-${token}`,
        userId: me,
        expiresAt: new Date(Date.now() + 3_600_000),
        chatDeviceId: deviceId,
      },
    });
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

  async function notified(
    createdAt: Date,
    type: 'MESSAGE_RECEIVED' | 'MESSAGE_REPLIED' = 'MESSAGE_RECEIVED',
  ) {
    const message = await db.chatMessage.create({
      data: { conversationId, senderId: bo, ciphertext: 'x', createdAt },
    });
    return db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type,
        entityType: 'MESSAGE',
        entityId: message.id,
      },
    });
  }

  it('knows when the device behind a login was registered', async () => {
    await expect(repository.findDeviceStart(sessionId, me)).resolves.toEqual(
      deviceStart,
    );
  });

  it("knows nothing for a login without a device, someone else's login, or a revoked device", async () => {
    await expect(repository.findDeviceStart('nope', me)).resolves.toBeNull();
    await expect(repository.findDeviceStart(sessionId, bo)).resolves.toBeNull();

    await db.chatDevice.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });
    await expect(repository.findDeviceStart(sessionId, me)).resolves.toBeNull();
    await db.chatDevice.update({
      where: { id: deviceId },
      data: { revokedAt: null },
    });
  });

  it('picks out message notifications for messages sent before the device, and only those', async () => {
    const before = await notified(new Date('2026-10-01T00:00:00Z'));
    const beforeReply = await notified(
      new Date('2026-10-02T00:00:00Z'),
      'MESSAGE_REPLIED',
    );
    const after = await notified(new Date('2026-10-11T00:00:00Z'));
    const like = await db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: 'p1',
      },
    });

    const ids = await repository.findMessageNotificationIdsBefore(
      me,
      deviceStart,
    );

    expect(ids.sort()).toEqual([before.id, beforeReply.id].sort());
    expect(ids).not.toContain(after.id);
    expect(ids).not.toContain(like.id);
  });

  it('counts and lists without them', async () => {
    const before = await notified(new Date('2026-10-01T00:00:00Z'));
    const after = await notified(new Date('2026-10-11T00:00:00Z'));
    const hidden = await repository.findMessageNotificationIdsBefore(
      me,
      deviceStart,
    );

    expect(await repository.countUnread(me)).toBe(2);
    expect(await repository.countUnread(me, hidden)).toBe(1);
    const listed = await repository.findByRecipient({
      recipientId: me,
      limit: 10,
      excludeIds: hidden,
    });
    expect(listed.map((item) => item.id)).toEqual([after.id]);
    expect(listed.map((item) => item.id)).not.toContain(before.id);
  });
});
