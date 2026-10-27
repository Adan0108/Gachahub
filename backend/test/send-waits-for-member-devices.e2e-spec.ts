import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ChatRepository } from '../src/chat/chat.repository';
import { MlsGroupRosterRepository } from '../src/mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
// #123: a message must not be encrypted while a member's device is outside the MLS group.
describe('Which member devices are missing from a chat group (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let chats: ChatRepository;
  const token = randomUUID().slice(0, 8);
  const id = (name: string) => `md-${name}-${token}`;
  const [alice, bob] = [id('alice'), id('bob')];
  const conversationIds: string[] = [];

  const device = (userId: string, name: string, revoked = false) =>
    db.chatDevice.create({
      data: {
        id: id(name),
        userId,
        signaturePublicKey: Buffer.from(name),
        ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        revokedAt: revoked ? new Date() : null,
      },
    });

  async function chatWithLeaves(deviceOwners: Array<[string, string]>) {
    const conversation = await db.chatConversation.create({
      data: {
        type: 'DIRECT',
        participants: { create: [{ userId: alice }, { userId: bob }] },
      },
    });
    conversationIds.push(conversation.id);
    for (const [userId, deviceId] of deviceOwners) {
      await db.mlsGroupMember.create({
        data: { conversationId: conversation.id, userId, deviceId, addedEpoch: 1 },
      });
    }
    return conversation.id;
  }

  const missing = (conversationId: string) =>
    db.$transaction((tx) =>
      chats.hasMemberDeviceMissingFromGroup(tx, conversationId, [alice, bob]),
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, ChatRepository, MlsGroupRosterRepository],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    chats = app.get(ChatRepository);

    await db.user.createMany({
      data: [alice, bob].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
      })),
    });
    await device(alice, 'alice-laptop');
    await device(bob, 'bob-phone');
    await device(bob, 'bob-old', true);
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({ where: { id: { in: conversationIds } } });
      await db.chatDevice.deleteMany({ where: { userId: { in: [alice, bob] } } });
      await db.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    }
    await app?.close();
  });

  it('is missing when Bob has a working device that is not in the group', async () => {
    expect(await missing(await chatWithLeaves([[alice, id('alice-laptop')]]))).toBe(true);
  });

  it('is complete when every working device is in, whatever happened to revoked ones', async () => {
    const conversationId = await chatWithLeaves([
      [alice, id('alice-laptop')],
      [bob, id('bob-phone')],
    ]);
    expect(await missing(conversationId)).toBe(false);
  });

  it('is not a gap before anyone has made the group', async () => {
    expect(await missing(await chatWithLeaves([]))).toBe(false);
  });
});
