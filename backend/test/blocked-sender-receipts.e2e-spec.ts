import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ChatRepository } from '../src/chat/chat.repository';
import { MlsGroupRosterRepository } from '../src/mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Receipts for a recipient who blocked the sender (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let repository: ChatRepository;
  const token = randomUUID();
  const id = (name: string) => `br-${name}-${token}`;
  const sender = id('sender');
  const blocker = id('blocker');
  const other = id('other');
  const users = [sender, blocker, other];
  let conversationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        ChatRepository,
        { provide: MlsGroupRosterRepository, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    repository = app.get(ChatRepository);

    await db.user.createMany({
      data: users.map((userId) => ({
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
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });

  const send = (alreadyReadUserIds?: string[]) =>
    db.$transaction((tx) =>
      repository.createMessage(tx, {
        conversationId,
        senderId: sender,
        participantUserIds: users,
        alreadyReadUserIds,
        ciphertext: 'x',
      }),
    );

  const receiptOf = (messageId: string, userId: string) =>
    db.chatMessageReceipt.findUniqueOrThrow({
      where: { messageId_userId: { messageId, userId } },
    });

  it('starts the blocker receipt read, so the message is not unread for them', async () => {
    const message = await send([blocker]);

    expect((await receiptOf(message.id, blocker)).readAt).not.toBeNull();
    expect((await receiptOf(message.id, other)).readAt).toBeNull();
    // Nothing says it was delivered to them either, so the sender learns nothing
    expect((await receiptOf(message.id, blocker)).deliveredAt).toBeNull();
  });

  it('leaves every other receipt unread as before', async () => {
    const message = await send();

    expect((await receiptOf(message.id, blocker)).readAt).toBeNull();
    expect((await receiptOf(message.id, sender)).readAt).not.toBeNull();
  });
});
