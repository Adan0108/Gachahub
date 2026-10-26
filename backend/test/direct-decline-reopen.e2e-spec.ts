import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ChatMembershipRepository } from '../src/chat/membership/chat-membership.repository';
import { ChatMembershipService } from '../src/chat/membership/chat-membership.service';
import { EventPublisherPort } from '../src/domain-events/event-publisher.port';
import { MlsGroupRosterRepository } from '../src/mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Declining a direct chat and changing your mind (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let membership: ChatMembershipService;
  const token = randomUUID().slice(0, 8);
  const id = (name: string) => `dd-${name}-${token}`;
  const asker = id('asker');
  const decliner = id('decliner');
  const conversationIds: string[] = [];

  const stateOf = async (conversationId: string, userId: string) =>
    (
      await db.chatParticipant.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId, userId } },
      })
    ).state;

  /** A direct chat where `asker` wrote first and `decliner` has not answered. */
  async function request() {
    const conversation = await db.chatConversation.create({
      data: {
        type: 'DIRECT',
        participants: {
          create: [
            { userId: asker, state: 'ACTIVE' },
            { userId: decliner, state: 'PENDING', pendingSince: new Date() },
          ],
        },
      },
    });
    conversationIds.push(conversation.id);
    return conversation.id;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        MlsGroupRosterRepository,
        ChatMembershipRepository,
        ChatMembershipService,
        { provide: EventPublisherPort, useValue: { publishMany: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    membership = app.get(ChatMembershipService);

    await db.user.createMany({
      data: [asker, decliner].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
      })),
    });
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({ where: { id: { in: conversationIds } } });
      await db.user.deleteMany({ where: { id: { in: [asker, decliner] } } });
    }
    await app?.close();
  });

  it('puts the decliner back in the chat, active, and leaves the other side alone', async () => {
    const conversationId = await request();
    await membership.declineInvite(conversationId, decliner);
    expect(await stateOf(conversationId, decliner)).toBe('DECLINED');

    await membership.reopenDirect(conversationId, decliner);

    expect(await stateOf(conversationId, decliner)).toBe('ACTIVE');
    expect(await stateOf(conversationId, asker)).toBe('ACTIVE');
  });

  it('brings back a decline that was still being applied', async () => {
    const conversationId = await request();
    await db.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId: decliner } },
      data: { state: 'LEAVING' },
    });

    await membership.reopenDirect(conversationId, decliner);

    expect(await stateOf(conversationId, decliner)).toBe('ACTIVE');
  });

  it('clears what hid the chat from them while it was declined', async () => {
    const conversationId = await request();
    await membership.declineInvite(conversationId, decliner);
    await db.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId: decliner } },
      data: { deletedAt: new Date(), archivedAt: new Date() },
    });

    await membership.reopenDirect(conversationId, decliner);

    const row = await db.chatParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId, userId: decliner } },
    });
    expect(row.deletedAt).toBeNull();
    expect(row.archivedAt).toBeNull();
  });

  it('can be declined and reopened again', async () => {
    const conversationId = await request();
    await membership.declineInvite(conversationId, decliner);
    await membership.reopenDirect(conversationId, decliner);

    await expect(membership.reopenDirect(conversationId, decliner)).resolves.toBeUndefined();
    expect(await stateOf(conversationId, decliner)).toBe('ACTIVE');
  });
});
