import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  Currency,
  DailyEarning,
  DailyGiverReputation,
  EconomySource,
  InteractionKind,
  LedgerEntry,
  LedgerReason,
  Prisma,
  ReputationRank,
  UserWallet,
} from '../generated/prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';
import { EconomyService } from './economy.service';
import { economyDay, rankFor } from './economy-rules';

type StoredUser = {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  createdAt: Date;
  publishedPosts: number;
  publishedComments: number;
};

/**
 * In-memory transactional test harness for EconomyService covering Phase 1 & Section 4.5 edge cases.
 */
function createFakeEconomyDb(now: Date) {
  const users = new Map<string, StoredUser>();
  const wallets = new Map<string, UserWallet>();
  const ledger: LedgerEntry[] = [];
  const dailyEarnings = new Map<string, DailyEarning>();
  const giverReputation = new Map<string, DailyGiverReputation>();
  const countedInteractions = new Set<string>();
  const hiddenPosts = new Set<string>();
  const hiddenComments = new Set<string>();
  const walletLockOrder: string[] = [];
  const dayLockOrder: string[] = [];

  let nextId = 1;
  const oldEnough = new Date(now.getTime() - 30 * 86_400_000);

  const seedUser = (
    id: string,
    overrides: Partial<StoredUser> = {},
  ): StoredUser => {
    const user: StoredUser = {
      id,
      status: 'ACTIVE',
      createdAt: oldEnough,
      publishedPosts: 5,
      publishedComments: 10,
      ...overrides,
    };
    users.set(id, user);
    return user;
  };

  const dayKey = (userId: string, day: Date) =>
    `${userId}:${day.toISOString().slice(0, 10)}`;
  const giverKey = (ownerId: string, giverId: string, day: Date) =>
    `${ownerId}:${giverId}:${day.toISOString().slice(0, 10)}`;
  const interactionKey = (
    kind: InteractionKind,
    targetType: EconomySource,
    targetId: string,
    actorId: string,
  ) => `${kind}:${targetType}:${targetId}:${actorId}`;

  const tx = {
    user: {
      findUnique: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string };
          select?: { _count?: { select?: { posts?: any; comments?: any } } };
        }) => {
          const u = users.get(where.id);
          if (!u) return null;
          // Verify that _count filters for PUBLISHED and non-deleted content
          const postsWhere = select?._count?.select?.posts?.where;
          const commentsWhere = select?._count?.select?.comments?.where;
          const postCount =
            postsWhere?.status === 'PUBLISHED' && postsWhere?.deletedAt === null
              ? u.publishedPosts
              : 0;
          const commentCount =
            commentsWhere?.status === 'PUBLISHED' &&
            commentsWhere?.deletedAt === null
              ? u.publishedComments
              : 0;
          return {
            id: u.id,
            status: u.status,
            createdAt: u.createdAt,
            _count: { posts: postCount, comments: commentCount },
          };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        if (!u) throw new NotFoundException('User not found');
        return u;
      }),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; status: string };
        }) =>
          where.id.in
            .map((id) => users.get(id))
            .filter(
              (u): u is StoredUser => Boolean(u) && u!.status === where.status,
            )
            .map((u) => ({ id: u.id })),
      ),
    },
    userWallet: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
        return wallets.get(where.userId) ?? null;
      }),
      findMany: jest.fn(async () => [...wallets.values()]),
      upsert: jest.fn(
        async ({ where }: { where: { userId: string } }): Promise<UserWallet> => {
          walletLockOrder.push(where.userId);
          const existing = wallets.get(where.userId);
          if (existing) return { ...existing };
          const created: UserWallet = {
            userId: where.userId,
            reputation: 0,
            shards: 0,
            prisms: 0,
            reputation90d: 0,
            rank: 'STARGAZER' as ReputationRank,
            rankUpdatedAt: now,
            updatedAt: now,
          };
          wallets.set(where.userId, created);
          return { ...created };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string };
          data: Record<string, any>;
        }): Promise<UserWallet> => {
          const current = wallets.get(where.userId)!;
          const applyNum = (val: number, op: any) => {
            if (typeof op === 'number') return op;
            if (op?.increment !== undefined) return val + op.increment;
            if (op?.decrement !== undefined) return val - op.decrement;
            return val;
          };
          const updated: UserWallet = {
            ...current,
            reputation: applyNum(current.reputation, data.reputation),
            shards: applyNum(current.shards, data.shards),
            prisms: applyNum(current.prisms, data.prisms),
            reputation90d: applyNum(current.reputation90d, data.reputation90d),
            rank: (data.rank ?? current.rank) as ReputationRank,
            rankUpdatedAt: data.rankUpdatedAt ?? current.rankUpdatedAt,
            updatedAt: now,
          };
          wallets.set(where.userId, updated);
          return { ...updated };
        },
      ),
    },
    dailyEarning: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { userId_day: { userId: string; day: Date } };
        }) => {
          return (
            dailyEarnings.get(
              dayKey(where.userId_day.userId, where.userId_day.day),
            ) ?? null
          );
        },
      ),
      upsert: jest.fn(
        async ({
          where,
        }: {
          where: { userId_day: { userId: string; day: Date } };
        }): Promise<DailyEarning> => {
          const { userId, day } = where.userId_day;
          dayLockOrder.push(userId);
          const key = dayKey(userId, day);
          const existing = dailyEarnings.get(key);
          if (existing) return { ...existing };
          const created: DailyEarning = {
            userId,
            day,
            baseShards: 0,
            creditedShards: 0,
            likesCounted: 0,
            commentsCounted: 0,
            repFromLikes: 0,
            repFromComments: 0,
            commentsWritten: 0,
          };
          dailyEarnings.set(key, created);
          return { ...created };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { userId_day: { userId: string; day: Date } };
          data: Record<string, any>;
        }): Promise<DailyEarning> => {
          const key = dayKey(where.userId_day.userId, where.userId_day.day);
          const current = dailyEarnings.get(key)!;
          const updated = { ...current };
          for (const [k, v] of Object.entries(data)) {
            if (v?.increment !== undefined) {
              (updated as any)[k] += v.increment;
            }
          }
          dailyEarnings.set(key, updated);
          return { ...updated };
        },
      ),
    },
    dailyGiverReputation: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            ownerId_giverId_day: {
              ownerId: string;
              giverId: string;
              day: Date;
            };
          };
        }) => {
          const { ownerId, giverId, day } = where.ownerId_giverId_day;
          return giverReputation.get(giverKey(ownerId, giverId, day)) ?? null;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: {
            ownerId_giverId_day: {
              ownerId: string;
              giverId: string;
              day: Date;
            };
          };
          create: DailyGiverReputation;
          update: { reputation: { increment: number } };
        }) => {
          const { ownerId, giverId, day } = where.ownerId_giverId_day;
          const key = giverKey(ownerId, giverId, day);
          const existing = giverReputation.get(key);
          if (!existing) {
            giverReputation.set(key, { ...create });
            return { ...create };
          }
          existing.reputation += update.reputation.increment;
          return { ...existing };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { day: { lt: Date } } }) => {
        let count = 0;
        for (const [key, row] of giverReputation.entries()) {
          if (row.day.getTime() < where.day.lt.getTime()) {
            giverReputation.delete(key);
            count++;
          }
        }
        return { count };
      }),
    },
    countedInteraction: {
      createMany: jest.fn(
        async ({
          data,
        }: {
          data: {
            kind: InteractionKind;
            targetType: EconomySource;
            targetId: string;
            actorId: string;
            ownerId: string;
          }[];
        }) => {
          let count = 0;
          for (const row of data) {
            const key = interactionKey(
              row.kind,
              row.targetType,
              row.targetId,
              row.actorId,
            );
            if (!countedInteractions.has(key)) {
              countedInteractions.add(key);
              count++;
            }
          }
          return { count };
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            kind: InteractionKind;
            targetType: EconomySource;
            targetId: string;
          };
        }) => {
          const prefix = `${where.kind}:${where.targetType}:${where.targetId}:`;
          let total = 0;
          for (const key of countedInteractions) {
            if (key.startsWith(prefix)) total++;
          }
          return total;
        },
      ),
    },
    ledgerEntry: {
      findUnique: jest.fn(
        async ({ where }: { where: { idempotencyKey: string } }) =>
          ledger.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
      ),
      findMany: jest.fn(async ({ where = {} }: { where?: Record<string, any> }) => {
        return ledger.filter((entry) => {
          if (where.userId && entry.userId !== where.userId) return false;
          if (where.sourceType && entry.sourceType !== where.sourceType)
            return false;
          if (where.sourceId && entry.sourceId !== where.sourceId) return false;
          if (where.actorId && entry.actorId !== where.actorId) return false;
          if (where.reason?.in && !where.reason.in.includes(entry.reason))
            return false;
          if (where.revokedAt === null && entry.revokedAt !== null) return false;
          if (where.revokedCause && entry.revokedCause !== where.revokedCause)
            return false;
          return true;
        });
      }),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const entry: LedgerEntry = {
          id: `led-${nextId++}`,
          userId: data.userId,
          currency: data.currency,
          delta: data.delta,
          balanceAfter: data.balanceAfter,
          reason: data.reason as LedgerReason,
          sourceType: data.sourceType ?? null,
          sourceId: data.sourceId ?? null,
          actorId: data.actorId ?? null,
          awardId: data.awardId ?? null,
          revokedAt: null,
          revokedCause: null,
          revokedAmount: null,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata ?? null,
          createdAt: now,
        };
        ledger.push(entry);
        return entry;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<LedgerEntry>;
        }) => {
          const entry = ledger.find((e) => e.id === where.id)!;
          Object.assign(entry, data);
          return entry;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string | { in: string[] };
            revokedAt?: null | { not: null };
          };
          data: Partial<LedgerEntry>;
        }) => {
          let count = 0;
          for (const entry of ledger) {
            const idMatch =
              typeof where.id === 'string'
                ? entry.id === where.id
                : where.id?.in
                  ? where.id.in.includes(entry.id)
                  : true;
            if (!idMatch) continue;
            if (where.revokedAt === null && entry.revokedAt !== null) continue;
            if (
              where.revokedAt &&
              typeof where.revokedAt === 'object' &&
              entry.revokedAt === null
            ) {
              continue;
            }
            Object.assign(entry, data);
            count++;
          }
          return { count };
        },
      ),
      aggregate: jest.fn(
        async ({
          where,
        }: {
          where: {
            userId: string;
            currency: Currency;
            reason: { in: LedgerReason[] };
            revokedAt: null;
            createdAt: { gte: Date };
          };
        }) => {
          const total = ledger
            .filter(
              (e) =>
                e.userId === where.userId &&
                e.currency === where.currency &&
                where.reason.in.includes(e.reason) &&
                e.revokedAt === null &&
                e.createdAt.getTime() >= where.createdAt.gte.getTime(),
            )
            .reduce((acc, e) => acc + e.delta, 0);
          return { _sum: { delta: total } };
        },
      ),
      groupBy: jest.fn(async () => {
        const grouped = new Map<
          string,
          { userId: string; currency: Currency; _sum: { delta: number } }
        >();
        for (const e of ledger) {
          const key = `${e.userId}:${e.currency}`;
          const cur = grouped.get(key) ?? {
            userId: e.userId,
            currency: e.currency,
            _sum: { delta: 0 },
          };
          cur._sum.delta += e.delta;
          grouped.set(key, cur);
        }
        return [...grouped.values()];
      }),
    },
    post: {
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] }; status: string } }) =>
          where.id.in
            .filter((id) => hiddenPosts.has(id))
            .map((id) => ({ id })),
      ),
    },
    comment: {
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] }; status: string } }) =>
          where.id.in
            .filter((id) => hiddenComments.has(id))
            .map((id) => ({ id })),
      ),
    },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (t: Prisma.TransactionClient) => unknown) =>
      cb(tx as unknown as Prisma.TransactionClient),
    ),
  };

  return {
    prisma: prisma as unknown as PrismaService,
    tx: tx as unknown as Prisma.TransactionClient,
    users,
    wallets,
    ledger,
    dailyEarnings,
    giverReputation,
    hiddenPosts,
    hiddenComments,
    walletLockOrder,
    dayLockOrder,
    seedUser,
  };
}

describe('EconomyService', () => {
  const now = new Date('2026-10-30T05:00:00Z');
  let db: ReturnType<typeof createFakeEconomyDb>;
  let auditLogService: { recordOrThrow: jest.Mock };
  let service: EconomyService;

  beforeEach(() => {
    db = createFakeEconomyDb(now);
    auditLogService = { recordOrThrow: jest.fn().mockResolvedValue(undefined) };
    service = new EconomyService(
      db.prisma,
      auditLogService as unknown as AuditLogService,
    );
  });

  describe('recordLike & earning edge cases (Section 4.5)', () => {
    it('awards nothing when liking your own post or comment', async () => {
      db.seedUser('author-1');
      await service.recordLike(
        db.tx,
        {
          targetType: 'POST',
          targetId: 'post-1',
          ownerId: 'author-1',
          likerId: 'author-1',
        },
        now,
      );
      expect(db.ledger).toHaveLength(0);
    });

    it('awards nothing when the liker is not established or only has draft/deleted/hidden content', async () => {
      db.seedUser('author-1');
      db.seedUser('bot-1', { publishedPosts: 0, publishedComments: 0 });

      await service.recordLike(
        db.tx,
        {
          targetType: 'POST',
          targetId: 'post-1',
          ownerId: 'author-1',
          likerId: 'bot-1',
        },
        now,
      );
      expect(db.ledger).toHaveLength(0);
    });

    it('awards 1 Reputation and 1 Shard once ever per (liker, target), ignoring like -> unlike -> like cycling', async () => {
      db.seedUser('author-1');
      db.seedUser('liker-1');

      await service.recordLike(
        db.tx,
        {
          targetType: 'POST',
          targetId: 'post-1',
          ownerId: 'author-1',
          likerId: 'liker-1',
        },
        now,
      );
      await service.recordLike(
        db.tx,
        {
          targetType: 'POST',
          targetId: 'post-1',
          ownerId: 'author-1',
          likerId: 'liker-1',
        },
        now,
      );

      const wallet = await service.getWallet('author-1', now);
      expect(wallet.reputation).toBe(1);
      expect(wallet.shards).toBe(1);
      expect(db.ledger).toHaveLength(2);
    });

    it('enforces the per-giver daily cap of 5 Reputation per author while still counting toward Shard milestones', async () => {
      db.seedUser('author-1');
      db.seedUser('fan-1');

      for (let i = 1; i <= 7; i++) {
        await service.recordLike(
          db.tx,
          {
            targetType: 'POST',
            targetId: `post-${i}`,
            ownerId: 'author-1',
            likerId: 'fan-1',
          },
          now,
        );
      }

      const wallet = await service.getWallet('author-1', now);
      expect(wallet.reputation).toBe(5);
      expect(wallet.shards).toBe(7);
    });

    it('awards milestone Shards (10 -> +5) even when the author has already hit the 60-Shard daily cap', async () => {
      db.seedUser('author-1');
      const day = economyDay(now);
      db.dailyEarnings.set(`${'author-1'}:${day.toISOString().slice(0, 10)}`, {
        userId: 'author-1',
        day,
        baseShards: 60,
        creditedShards: 60,
        likesCounted: 0,
        commentsCounted: 0,
        repFromLikes: 0,
        repFromComments: 0,
        commentsWritten: 0,
      });

      for (let i = 1; i <= 10; i++) {
        db.seedUser(`liker-${i}`);
        await service.recordLike(
          db.tx,
          {
            targetType: 'POST',
            targetId: 'viral-post',
            ownerId: 'author-1',
            likerId: `liker-${i}`,
          },
          now,
        );
      }

      const wallet = await service.getWallet('author-1', now);
      expect(wallet.reputation).toBe(10);
      // Capped likes gave 0 Shards, but the 10-like milestone still paid 5 Shards
      expect(wallet.shards).toBe(5);
      expect(
        db.ledger.some(
          (e) => e.reason === 'LIKE_MILESTONE' && e.delta === 5,
        ),
      ).toBe(true);
    });
  });

  describe('recordComment & lock ordering', () => {
    it('locks wallets in ascending userId order even when commenterId > postOwnerId, and sets actorId on COMMENT_WRITTEN', async () => {
      db.seedUser('author-a');
      db.seedUser('user-z');

      await service.recordComment(
        db.tx,
        {
          commentId: 'c-1',
          postId: 'post-1',
          postOwnerId: 'author-a',
          commenterId: 'user-z',
        },
        now,
      );

      // First two wallet locks must be sorted ['author-a', 'user-z']
      expect(db.dayLockOrder.slice(0, 2)).toEqual(['author-a', 'user-z']);
      expect(db.walletLockOrder.slice(0, 2)).toEqual(['author-a', 'user-z']);

      const writtenAward = db.ledger.find(
        (e) => e.reason === 'COMMENT_WRITTEN',
      );
      expect(writtenAward).toBeDefined();
      expect(writtenAward?.actorId).toBe('user-z');
      expect(writtenAward?.delta).toBe(1);
    });

    it('pays the commenter 1 Shard for only the first 3 comments a day and pays post owner only on the first comment per post', async () => {
      db.seedUser('author-1');
      db.seedUser('commenter-1');

      for (let i = 1; i <= 4; i++) {
        await service.recordComment(
          db.tx,
          {
            commentId: `c-${i}`,
            postId: 'post-1',
            postOwnerId: 'author-1',
            commenterId: 'commenter-1',
          },
          now,
        );
      }

      const commenterWallet = await service.getWallet('commenter-1', now);
      const authorWallet = await service.getWallet('author-1', now);
      expect(commenterWallet.shards).toBe(3);
      expect(authorWallet.reputation).toBe(1);
      expect(authorWallet.shards).toBe(1);
    });

    it('awards nothing when the commenter is SUSPENDED', async () => {
      db.seedUser('author-1');
      db.seedUser('suspended-1', { status: 'SUSPENDED' });

      await service.recordComment(
        db.tx,
        {
          commentId: 'c-1',
          postId: 'post-1',
          postOwnerId: 'author-1',
          commenterId: 'suspended-1',
        },
        now,
      );

      expect(db.ledger).toHaveLength(0);
    });
  });

  describe('checkIn', () => {
    it('credits 10 Shards once per UTC+7 day and rejects duplicate check-in with 409', async () => {
      db.seedUser('user-1');

      const res = await service.checkIn('user-1', now);
      expect(res).toEqual({ shards: 10 });

      const wallet = await service.getWallet('user-1', now);
      expect(wallet.shards).toBe(10);
      expect(wallet.today.checkedIn).toBe(true);

      await expect(service.checkIn('user-1', now)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects check-in for a SUSPENDED user', async () => {
      db.seedUser('user-1', { status: 'SUSPENDED' });
      await expect(service.checkIn('user-1', now)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('moderation clawback & restore (revokeForContent / restoreForContent)', () => {
    it('claws back earnings when content is hidden, floors balance and reputation90d at 0 with shortfall recorded, and restores on unhide', async () => {
      db.seedUser('author-1');
      db.seedUser('liker-1');

      await service.recordLike(
        db.tx,
        {
          targetType: 'POST',
          targetId: 'post-1',
          ownerId: 'author-1',
          likerId: 'liker-1',
        },
        now,
      );

      // Simulate author spending their 1 Shard and having reputation90d tampered to 0 before clawback
      db.wallets.get('author-1')!.shards = 0;
      db.wallets.get('author-1')!.reputation90d = 0;

      await service.revokeForContent(db.tx, 'POST', 'post-1');

      const afterRevoke = await service.getWallet('author-1', now);
      expect(afterRevoke.reputation).toBe(0);
      expect(afterRevoke.reputation90d).toBe(0);
      expect(afterRevoke.shards).toBe(0);

      const shardRevoke = db.ledger.find(
        (e) => e.reason === 'REVOKED' && e.currency === 'SHARDS',
      );
      expect(shardRevoke?.delta).toBe(-0);
      expect(shardRevoke?.metadata).toEqual({
        cause: 'CONTENT',
        shortfall: 1,
      });

      await service.restoreForContent(db.tx, 'POST', 'post-1');

      const afterRestore = await service.getWallet('author-1', now);
      expect(afterRestore.reputation).toBe(1);
      // Only what was actually taken (0 Shards) is restored
      expect(afterRestore.shards).toBe(0);
    });
  });

  describe('adjust and refreshRank', () => {
    it('adjusts balance, updates rank, writes audit log, and refuses negative resulting balances', async () => {
      db.seedUser('user-1');

      await service.adjust({
        adminId: 'admin-1',
        userId: 'user-1',
        currency: 'REPUTATION',
        delta: 1_500,
        reason: 'Contest winner',
      });

      const wallet = await service.getWallet('user-1', now);
      expect(wallet.reputation).toBe(1_500);
      expect(wallet.rank).toBe('METEOR');
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WALLET_ADJUSTED',
          actorId: 'admin-1',
          targetId: 'user-1',
        }),
        expect.anything(),
      );

      await expect(
        service.adjust({
          adminId: 'admin-1',
          userId: 'user-1',
          currency: 'REPUTATION',
          delta: -2_000,
          reason: 'Too much',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('steps down SUPERNOVA/GALAXY in refreshRank when 90d reputation expires', async () => {
      db.seedUser('veteran-1');
      db.wallets.set('veteran-1', {
        userId: 'veteran-1',
        reputation: 75_000,
        shards: 0,
        prisms: 0,
        reputation90d: 4_000,
        rank: rankFor(75_000, 4_000),
        rankUpdatedAt: new Date(now.getTime() - 86_400_000),
        updatedAt: now,
      });

      const refreshed = await service.refreshStaleRanks(now);
      expect(refreshed).toBe(1);

      const wallet = await service.getWallet('veteran-1', now);
      expect(wallet.reputation90d).toBe(0);
      expect(wallet.rank).toBe('NOVA');
    });
  });
});
