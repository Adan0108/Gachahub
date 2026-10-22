import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Stacked chat notifications (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let repository: NotificationRepository;
  const token = randomUUID();
  const id = (name: string) => `ns2-${name}-${token}`;
  const me = id('me');
  const cy = id('cy');
  const bo = id('bo');
  let dm: string;
  let group: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, NotificationRepository],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    repository = app.get(NotificationRepository);

    await db.user.createMany({
      data: [me, cy, bo].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
      })),
    });
    dm = (await db.chatConversation.create({ data: {} })).id;
    group = (
      await db.chatConversation.create({
        data: { type: 'GROUP', title: 'Squad' },
      })
    ).id;
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({
        where: { id: { in: [dm, group] } },
      });
      await db.user.deleteMany({ where: { id: { in: [me, cy, bo] } } });
    }
    await app?.close();
  });

  afterEach(() =>
    db.notification.deleteMany({ where: { recipientId: { in: [me, cy] } } }),
  );

  const stack = (
    conversationId: string,
    messageId: string,
    recipients = [me],
  ) =>
    db.$transaction((tx) =>
      repository.upsertMessageStack(
        { recipientIds: recipients, actorId: bo, messageId, conversationId },
        tx,
      ),
    );
  const rowsOf = (userId: string) =>
    db.notification.findMany({ where: { recipientId: userId } });

  it('opens one row for the first message', async () => {
    const [row] = await stack(dm, 'm1');

    expect(row).toMatchObject({
      recipientId: me,
      type: 'MESSAGE_RECEIVED',
      entityType: 'MESSAGE',
      entityId: 'm1',
      conversationId: dm,
      count: 1,
      readAt: null,
    });
  });

  it('counts later messages on the same row, keeping the latest message', async () => {
    await stack(dm, 'm1');
    await stack(dm, 'm2');
    await stack(dm, 'm3');

    const rows = await rowsOf(me);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: 'm3', count: 3 });
  });

  it('brings the row up to the newest time', async () => {
    const [first] = await stack(dm, 'm1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [second] = await stack(dm, 'm2');

    expect(second.id).toBe(first.id);
    expect(second.createdAt.getTime()).toBeGreaterThan(
      first.createdAt.getTime(),
    );
  });

  it('keeps a row per conversation, and per person', async () => {
    await stack(dm, 'm1');
    await stack(group, 'm2');
    await stack(group, 'm3', [me, cy]);

    expect(await rowsOf(me)).toHaveLength(2);
    const cyRows = await rowsOf(cy);
    expect(cyRows).toHaveLength(1);
    expect(cyRows[0]).toMatchObject({ conversationId: group, count: 1 });
  });

  it('starts a fresh unread row once the old one was read', async () => {
    const [first] = await stack(dm, 'm1');
    await stack(dm, 'm2');
    await db.notification.update({
      where: { id: first.id },
      data: { readAt: new Date() },
    });

    const [fresh] = await stack(dm, 'm3');

    expect(fresh.id).not.toBe(first.id);
    expect(fresh).toMatchObject({ count: 1, entityId: 'm3', readAt: null });
    expect(await rowsOf(me)).toHaveLength(2);
  });

  it('never opens two unread rows when messages arrive together', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => stack(dm, `burst-${index}`)),
    );

    const rows = await rowsOf(me);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(8);
  });

  it('does not stack replies or other kinds: they keep their own rows', async () => {
    await stack(dm, 'm1');
    await db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type: 'MESSAGE_REPLIED',
        entityType: 'MESSAGE',
        entityId: 'm2',
        conversationId: dm,
      },
    });
    await db.notification.create({
      data: {
        recipientId: me,
        actorId: bo,
        type: 'MESSAGE_REPLIED',
        entityType: 'MESSAGE',
        entityId: 'm3',
        conversationId: dm,
      },
    });

    const rows = await rowsOf(me);
    expect(rows.filter((row) => row.type === 'MESSAGE_REPLIED')).toHaveLength(
      2,
    );
    expect(rows.filter((row) => row.type === 'MESSAGE_RECEIVED')).toHaveLength(
      1,
    );
  });

  it('says which conversations are groups, and their names', async () => {
    const summaries = await repository.findConversationSummaries([dm, group]);

    expect(
      Object.fromEntries(
        summaries.map((item) => [item.id, [item.type, item.title]]),
      ),
    ).toEqual({ [dm]: ['DIRECT', null], [group]: ['GROUP', 'Squad'] });
    await expect(repository.findConversationSummaries([])).resolves.toEqual([]);
  });
});
