import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { EconomyService } from '../src/economy/economy.service';
import type { AuditLogService } from '../src/audit-log/audit-log.service';

// Real PostgreSQL: the local test container only (docker compose test-postgres, port 5434), never the shared database.
// The database must already have every migration applied (`prisma migrate deploy` with this URL).
const url =
  process.env.ECONOMY_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5434/economy_shadow';

describe('Economy (local test database)', () => {
  jest.setTimeout(120_000);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  const economy = new EconomyService(
    prisma as unknown as PrismaService,
    { recordOrThrow: jest.fn() } as unknown as AuditLogService,
  );
  const run = `econ-${randomUUID().slice(0, 8)}`;
  const longAgo = new Date(Date.now() - 30 * 86_400_000);
  let counter = 0;

  /** An account old and active enough that its likes always count. */
  async function established(): Promise<string> {
    const id = `${run}-u${counter++}`;
    await prisma.user.create({
      data: {
        id,
        name: id,
        email: `${id}@test.local`,
        createdAt: longAgo,
        posts: {
          create: [
            { title: 'a', content: 'a' },
            { title: 'b', content: 'b' },
          ],
        },
      },
    });
    return id;
  }

  async function newcomer(): Promise<string> {
    const id = `${run}-new${counter++}`;
    await prisma.user.create({
      data: { id, name: id, email: `${id}@test.local` },
    });
    return id;
  }

  async function postBy(authorId: string): Promise<string> {
    const post = await prisma.post.create({
      data: { authorId, title: 't', content: 'c' },
    });
    return post.id;
  }

  const like = (ownerId: string, targetId: string, likerId: string) =>
    prisma.$transaction((tx) =>
      economy.recordLike(tx, {
        targetType: 'POST',
        targetId,
        ownerId,
        likerId,
      }),
    );

  const wallet = (userId: string) =>
    prisma.userWallet.findUnique({ where: { userId } });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { startsWith: run } } });
    await prisma.$disconnect();
  });

  it('pays the owner once per liker per post, never for self-likes or brand-new accounts', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const fan = await established();

    await like(owner, post, fan);
    await like(owner, post, fan);
    await like(owner, post, owner);
    await like(owner, post, await newcomer());

    expect(await wallet(owner)).toMatchObject({ reputation: 1, shards: 1 });
  });

  it('lets one person give the same author at most 5 Reputation a day', async () => {
    const owner = await established();
    const fan = await established();
    for (let index = 0; index < 7; index++) {
      await like(owner, await postBy(owner), fan);
    }
    expect(await wallet(owner)).toMatchObject({ reputation: 5, shards: 7 });
  });

  it('pays the 10-like milestone exactly once even when likes arrive together', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const fans = await Promise.all(
      Array.from({ length: 12 }, () => established()),
    );

    await Promise.all(fans.map((fan) => like(owner, post, fan)));

    const milestones = await prisma.ledgerEntry.count({
      where: { userId: owner, reason: 'LIKE_MILESTONE' },
    });
    expect(milestones).toBe(1);
    expect(await wallet(owner)).toMatchObject({
      reputation: 12,
      shards: 12 + 5,
    });
  });

  it('stops Shards at the daily cap but keeps paying Reputation', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const fans = await Promise.all(
      Array.from({ length: 65 }, () => established()),
    );
    for (const fan of fans) await like(owner, post, fan);

    // 60 capped + milestone bonuses (10 and 50 likes), which skip the cap.
    expect(await wallet(owner)).toMatchObject({
      reputation: 65,
      shards: 60 + 5 + 20,
    });
  });

  it('takes earnings back when content is hidden and gives back exactly that on restore', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const fans = await Promise.all([established(), established()]);
    for (const fan of fans) await like(owner, post, fan);
    await prisma.userWallet.update({
      where: { userId: owner },
      data: { shards: 1 }, // spent one already
    });

    await prisma.$transaction((tx) =>
      economy.revokeForContent(tx, 'POST', post),
    );
    expect(await wallet(owner)).toMatchObject({ reputation: 0, shards: 0 });

    await prisma.$transaction((tx) =>
      economy.restoreForContent(tx, 'POST', post),
    );
    // Only what was actually taken comes back: 2 Reputation, 1 Shard.
    expect(await wallet(owner)).toMatchObject({ reputation: 2, shards: 1 });
  });

  it('a ban takes back what that person gave; restoring hidden content skips them until unbanned', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const fan = await established();
    await like(owner, post, fan);

    await prisma.user.update({
      where: { id: fan },
      data: { status: 'BANNED' },
    });
    await prisma.$transaction((tx) => economy.revokeForActor(tx, fan));
    expect(await wallet(owner)).toMatchObject({ reputation: 0 });

    await prisma.$transaction((tx) =>
      economy.revokeForContent(tx, 'POST', post),
    );
    await prisma.$transaction((tx) =>
      economy.restoreForContent(tx, 'POST', post),
    );
    expect(await wallet(owner)).toMatchObject({ reputation: 0 });

    await prisma.user.update({
      where: { id: fan },
      data: { status: 'ACTIVE' },
    });
    await prisma.$transaction((tx) => economy.restoreForActor(tx, fan));
    expect(await wallet(owner)).toMatchObject({ reputation: 1, shards: 1 });
  });

  it('counts only the first comment per person per post, and pays the writer for 3 comments a day', async () => {
    const owner = await established();
    const post = await postBy(owner);
    const writer = await established();
    for (let index = 0; index < 4; index++) {
      const comment = await prisma.comment.create({
        data: { postId: post, authorId: writer, content: `c${index}` },
      });
      await prisma.$transaction((tx) =>
        economy.recordComment(tx, {
          commentId: comment.id,
          postId: post,
          postOwnerId: owner,
          commenterId: writer,
        }),
      );
    }
    expect(await wallet(owner)).toMatchObject({ reputation: 1, shards: 1 });
    expect(await wallet(writer)).toMatchObject({ reputation: 0, shards: 3 });
  });

  it('checks in once a day', async () => {
    const user = await established();
    await expect(economy.checkIn(user)).resolves.toEqual({ shards: 10 });
    await expect(economy.checkIn(user)).rejects.toThrow('Already checked in');
    expect(await wallet(user)).toMatchObject({ shards: 10 });
  });

  it('ranks up from Reputation earned and keeps the rank in step with the ledger', async () => {
    const owner = await established();
    const fans = await Promise.all(
      Array.from({ length: 21 }, () => established()),
    );
    // 21 fans x 5 posts each = 105 Reputation (5 per fan per day).
    const posts = await Promise.all(
      Array.from({ length: 5 }, () => postBy(owner)),
    );
    for (const fan of fans) {
      for (const post of posts) await like(owner, post, fan);
    }
    expect(await wallet(owner)).toMatchObject({
      reputation: 105,
      reputation90d: 105,
      rank: 'METEOR',
    });

    await economy.refreshRank(owner);
    expect(await wallet(owner)).toMatchObject({
      reputation90d: 105,
      rank: 'METEOR',
    });
  });
});
