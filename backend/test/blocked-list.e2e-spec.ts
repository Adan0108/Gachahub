import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { BlocksRepository } from '../src/blocks/blocks.repository';
import { BlocksService } from '../src/blocks/blocks.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('The list of people you blocked (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let service: BlocksService;
  const token = randomUUID();
  const id = (name: string) => `bl-${name}-${token}`;
  const me = id('me');
  const bo = id('bo');
  const cy = id('cy');
  const gone = id('gone');
  const users = [me, bo, cy, gone];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, BlocksRepository, BlocksService],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    service = app.get(BlocksService);

    await db.user.createMany({
      data: users.map((userId) => ({
        id: userId,
        name: `Name ${userId.slice(3, 7)}`,
        email: `${userId}@example.invalid`,
        status: userId === gone ? 'SUSPENDED' : 'ACTIVE',
      })),
    });
  });

  afterAll(async () => {
    if (db) await db.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
  });

  afterEach(() => db.chatUserBlock.deleteMany({ where: { blockerId: me } }));

  it('lists the blocked people newest block first, with their details', async () => {
    await db.chatUserBlock.create({
      data: { blockerId: me, blockedId: bo, createdAt: new Date(2026, 9, 1) },
    });
    await db.chatUserBlock.create({
      data: { blockerId: me, blockedId: cy, createdAt: new Date(2026, 9, 2) },
    });

    const list = await service.listBlockedUsers(me);

    expect(list.map((person) => person.id)).toEqual([cy, bo]);
    expect(list[0]).toMatchObject({ id: cy, name: expect.any(String) });
    expect(list[0].blockedAt).toEqual(new Date(2026, 9, 2));
  });

  it('leaves out suspended people and anyone blocked by someone else', async () => {
    await db.chatUserBlock.create({ data: { blockerId: me, blockedId: gone } });
    await db.chatUserBlock.create({ data: { blockerId: bo, blockedId: cy } });

    await expect(service.listBlockedUsers(me)).resolves.toEqual([]);
    await db.chatUserBlock.deleteMany({ where: { blockerId: bo } });
  });

  it('is empty when nobody is blocked', async () => {
    await expect(service.listBlockedUsers(me)).resolves.toEqual([]);
  });
});
