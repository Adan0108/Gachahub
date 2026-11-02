import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Currency,
  DailyEarning,
  EconomySource,
  LedgerEntry,
  LedgerReason,
  Prisma,
  RevokeCause,
  UserWallet,
} from '../generated/prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHECK_IN_SHARDS,
  DAILY_SHARD_CAP,
  nextEconomyDayStart,
  LIKE_MILESTONE_SHARDS,
  MAX_REPUTATION_PER_GIVER_PER_DAY,
  RANK_WINDOW_DAYS,
  SHARD_PAYING_COMMENTS_PER_DAY,
  SHARDS_PER_COUNTED_INTERACTION,
  economyDay,
  isEstablished,
  rankFor,
  reputationFromComments,
  reputationFromLikes,
  shardsToCredit,
  trustThresholds,
} from './economy-rules';

type Tx = Prisma.TransactionClient;

/** Ledger reasons that are earnings, and so can be taken back and count toward the rank. */
const AWARD_REASONS: LedgerReason[] = [
  'LIKE_RECEIVED',
  'COMMENT_RECEIVED',
  'LIKE_MILESTONE',
  'COMMENT_WRITTEN',
];

const checkInKey = (userId: string, day: Date) =>
  `checkin:${userId}:${day.toISOString().slice(0, 10)}`;

const BALANCE_FIELD = {
  REPUTATION: 'reputation',
  SHARDS: 'shards',
  PRISMS: 'prisms',
} as const;

const PUBLISHED_CONTENT = {
  status: 'PUBLISHED',
  deletedAt: null,
} as const;

type Credit = {
  userId: string;
  currency: Currency;
  delta: number;
  reason: LedgerReason;
  key: string;
  sourceType?: EconomySource;
  sourceId?: string;
  actorId?: string;
  awardId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Reputation and Shards: who earns what from likes and comments, the daily check-in, and taking earnings back
 * when moderation hides content or bans the person who gave them. Rules and numbers: docs/plans/economy-and-cosmetics.md.
 *
 * Every write runs inside the caller's transaction, so a like and what it earned commit together.
 * Row locks are taken in a fixed order (day rows by user id, then wallets by user id) so two transactions cannot deadlock.
 */
@Injectable()
export class EconomyService {
  private readonly trustSecret =
    process.env.ECONOMY_TRUST_SECRET ||
    (env.betterAuthSecret
      ? `economy-trust:${env.betterAuthSecret}`
      : 'dev-only-economy-trust-secret');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Your balances, rank and how today's earning stands. */
  async getWallet(userId: string, now = new Date()) {
    const day = economyDay(now);
    const [wallet, today, checkedIn] = await Promise.all([
      this.prisma.userWallet.findUnique({ where: { userId } }),
      this.prisma.dailyEarning.findUnique({
        where: { userId_day: { userId, day } },
      }),
      this.prisma.ledgerEntry.findUnique({
        where: { idempotencyKey: checkInKey(userId, day) },
        select: { id: true },
      }),
    ]);
    return {
      reputation: wallet?.reputation ?? 0,
      shards: wallet?.shards ?? 0,
      prisms: wallet?.prisms ?? 0,
      rank: wallet?.rank ?? 'STARGAZER',
      reputation90d: wallet?.reputation90d ?? 0,
      today: {
        shardsEarned: today?.creditedShards ?? 0,
        shardCap: DAILY_SHARD_CAP,
        checkedIn: Boolean(checkedIn),
        resetsAt: nextEconomyDayStart(now).toISOString(),
      },
    };
  }

  /** Your balance history, newest first. */
  async listLedger(userId: string, cursor?: string, limit = 30) {
    const items = await this.prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        currency: true,
        delta: true,
        balanceAfter: true,
        reason: true,
        sourceType: true,
        sourceId: true,
        createdAt: true,
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page.at(-1)!.id : null };
  }

  /** A new like on a post or comment: Reputation and Shards for its owner, and a milestone bonus when it lands on one. */
  async recordLike(
    tx: Tx,
    like: {
      targetType: EconomySource;
      targetId: string;
      ownerId: string;
      likerId: string;
    },
    now = new Date(),
  ): Promise<void> {
    const { targetType, targetId, ownerId, likerId } = like;
    if (ownerId === likerId) return;
    if (!(await this.canEarnFrom(tx, ownerId, likerId, now))) return;

    const counted = await tx.countedInteraction.createMany({
      data: [{ kind: 'LIKE', targetType, targetId, actorId: likerId, ownerId }],
      skipDuplicates: true,
    });
    if (counted.count === 0) return;

    const day = economyDay(now);
    // Locks the owner's day row first: concurrent likes on their content queue here, so milestone counts stay exact.
    const [ownerDay] = await this.lockDays(tx, [ownerId], day);
    const keyBase = `like:${targetType}:${targetId}:${likerId}`;

    await this.awardSteppedReputation(tx, {
      ownerId,
      giverId: likerId,
      day,
      countField: 'likesCounted',
      repField: 'repFromLikes',
      stepFn: reputationFromLikes,
      reason: 'LIKE_RECEIVED',
      key: `${keyBase}:rep`,
      sourceType: targetType,
      sourceId: targetId,
    });

    await this.creditCappedShards(
      tx,
      ownerDay,
      SHARDS_PER_COUNTED_INTERACTION,
      {
        reason: 'LIKE_RECEIVED',
        key: `${keyBase}:shards`,
        sourceType: targetType,
        sourceId: targetId,
        actorId: likerId,
      },
    );

    const likes = await tx.countedInteraction.count({
      where: { kind: 'LIKE', targetType, targetId },
    });
    const milestoneShards = LIKE_MILESTONE_SHARDS.get(likes);
    if (milestoneShards) {
      // Milestones are rare and once ever, so they are not held back by the daily cap.
      await this.credit(tx, {
        userId: ownerId,
        currency: 'SHARDS',
        delta: milestoneShards,
        reason: 'LIKE_MILESTONE',
        key: `milestone:${targetType}:${targetId}:${likes}`,
        sourceType: targetType,
        sourceId: targetId,
      });
    }
  }

  /**
   * A new comment or reply: a few Shards for writing it (first 3 a day on other people's posts),
   * and Reputation and Shards for the post's owner from each person's first comment on that post.
   */
  async recordComment(
    tx: Tx,
    comment: {
      commentId: string;
      postId: string;
      postOwnerId: string;
      commenterId: string;
    },
    now = new Date(),
  ): Promise<void> {
    const { commentId, postId, postOwnerId, commenterId } = comment;
    if (postOwnerId === commenterId) return;

    const { owner, actor } = await this.loadInteractionUsers(
      tx,
      postOwnerId,
      commenterId,
    );
    if (actor?.status !== 'ACTIVE') return;

    const day = economyDay(now);
    const days = await this.lockDays(tx, [commenterId, postOwnerId], day);
    // Lock both wallets in ascending user-id order before crediting either user, preventing AB-BA deadlocks.
    await this.lockWallets(tx, [commenterId, postOwnerId]);
    const commenterDay = days.find((row) => row.userId === commenterId)!;
    const ownerDay = days.find((row) => row.userId === postOwnerId)!;

    if (commenterDay.commentsWritten < SHARD_PAYING_COMMENTS_PER_DAY) {
      const updated = await tx.dailyEarning.update({
        where: { userId_day: { userId: commenterId, day } },
        data: { commentsWritten: { increment: 1 } },
      });
      await this.creditCappedShards(tx, updated, 1, {
        reason: 'COMMENT_WRITTEN',
        key: `comment-written:${commentId}`,
        sourceType: 'COMMENT',
        sourceId: commentId,
        actorId: commenterId,
      });
    }

    if (
      owner?.status !== 'ACTIVE' ||
      !isEstablished(
        {
          status: actor.status,
          createdAt: actor.createdAt,
          postCount: actor._count.posts,
          commentCount: actor._count.comments,
        },
        trustThresholds(this.trustSecret, commenterId),
        now,
      )
    ) {
      return;
    }

    const counted = await tx.countedInteraction.createMany({
      data: [
        {
          kind: 'COMMENT',
          targetType: 'POST',
          targetId: postId,
          actorId: commenterId,
          ownerId: postOwnerId,
        },
      ],
      skipDuplicates: true,
    });
    if (counted.count === 0) return;

    const keyBase = `comment:${postId}:${commenterId}`;
    await this.awardSteppedReputation(tx, {
      ownerId: postOwnerId,
      giverId: commenterId,
      day,
      countField: 'commentsCounted',
      repField: 'repFromComments',
      stepFn: reputationFromComments,
      reason: 'COMMENT_RECEIVED',
      key: `${keyBase}:rep`,
      sourceType: 'COMMENT',
      sourceId: commentId,
    });

    await this.creditCappedShards(
      tx,
      ownerDay,
      SHARDS_PER_COUNTED_INTERACTION,
      {
        reason: 'COMMENT_RECEIVED',
        key: `${keyBase}:shards`,
        sourceType: 'COMMENT',
        sourceId: commentId,
        actorId: commenterId,
      },
    );
  }

  /** Today's check-in; a second call the same day changes nothing. */
  async checkIn(userId: string, now = new Date()) {
    const day = economyDay(now);
    const key = checkInKey(userId, day);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true },
      });
      if (user.status !== 'ACTIVE') {
        throw new BadRequestException('Your account cannot earn right now');
      }
      const [today] = await this.lockDays(tx, [userId], day);
      const already = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: key },
      });
      if (already) {
        throw new ConflictException('Already checked in today');
      }
      const updated = await tx.dailyEarning.update({
        where: { userId_day: { userId, day: today.day } },
        data: { baseShards: { increment: CHECK_IN_SHARDS } },
      });
      const shards = shardsToCredit(updated.baseShards, updated.creditedShards);
      if (shards > 0) {
        await tx.dailyEarning.update({
          where: { userId_day: { userId, day: today.day } },
          data: { creditedShards: { increment: shards } },
        });
      }
      // Always written, even at the cap, so the check-in itself is remembered.
      await this.credit(tx, {
        userId,
        currency: 'SHARDS',
        delta: shards,
        reason: 'DAILY_CHECKIN',
        key,
      });
      return { shards };
    });
  }

  /** Takes back everything a post or comment earned (it was hidden). */
  async revokeForContent(tx: Tx, sourceType: EconomySource, sourceId: string) {
    const awards = await tx.ledgerEntry.findMany({
      where: {
        sourceType,
        sourceId,
        reason: { in: AWARD_REASONS },
        revokedAt: null,
      },
    });
    await this.revoke(tx, awards, 'CONTENT');
  }

  /** Gives back exactly what hiding took. */
  async restoreForContent(tx: Tx, sourceType: EconomySource, sourceId: string) {
    const awards = await tx.ledgerEntry.findMany({
      where: { sourceType, sourceId, revokedCause: 'CONTENT' },
    });
    await this.restore(tx, awards);
  }

  /** An admin's correction, with a reason; cannot take a balance below 0. */
  async adjust(params: {
    adminId: string;
    userId: string;
    currency: Currency;
    delta: number;
    reason: string;
  }) {
    const { adminId, userId, currency, delta, reason } = params;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const wallet = await this.lockWallet(tx, userId);
      if (wallet[BALANCE_FIELD[currency]] + delta < 0) {
        throw new BadRequestException('That would take the balance below 0');
      }
      const entry = await this.credit(tx, {
        userId,
        currency,
        delta,
        reason: 'ADMIN_ADJUST',
        key: `adjust:${randomUUID()}`,
        actorId: adminId,
        metadata: { reason },
      });
      await this.auditLogService.recordOrThrow(
        {
          action: 'WALLET_ADJUSTED',
          actorId: adminId,
          targetType: 'USER',
          targetId: userId,
          metadata: {
            currency,
            delta,
            balanceAfter: entry.balanceAfter,
            reason,
            ledgerEntryId: entry.id,
          },
        },
        tx,
      );
      return entry;
    });
  }

  /**
   * Compensates owners of a deactivated cosmetic item with its duplicate Shard value (Section 6.6).
   * Locks all owner wallets in ascending user-id order and writes one TAKEDOWN_REFUND ledger row per owner.
   */
  async creditTakedownRefunds(
    tx: Tx,
    params: {
      userIds: string[];
      itemId: string;
      amount: number;
      actorId: string;
    },
  ): Promise<number> {
    const { userIds, itemId, amount, actorId } = params;
    if (amount <= 0 || userIds.length === 0) return 0;
    const ordered = [...new Set(userIds)].sort();
    await this.lockWallets(tx, ordered);
    let refunded = 0;
    for (const userId of ordered) {
      const key = `takedown:${itemId}:${userId}`;
      const existing = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) continue;
      await this.credit(tx, {
        userId,
        currency: 'SHARDS',
        delta: amount,
        reason: 'TAKEDOWN_REFUND',
        key,
        sourceType: 'COSMETIC',
        sourceId: itemId,
        actorId,
      });
      refunded++;
    }
    return refunded;
  }

  /** Nightly: the per-giver limit only ever reads today's rows, so earlier days are dead weight. */
  async pruneOldGiverDays(now = new Date()) {
    const { count } = await this.prisma.dailyGiverReputation.deleteMany({
      where: { day: { lt: economyDay(now) } },
    });
    return count;
  }

  /** Nightly: ranks of people whose old Reputation may have left the 90-day window (only the top two ranks can slip, but anyone with recent Reputation is rechecked). */
  async refreshStaleRanks(now = new Date()) {
    const stale = await this.prisma.userWallet.findMany({
      where: {
        OR: [
          { reputation90d: { gt: 0 } },
          { rank: { in: ['SUPERNOVA', 'GALAXY'] } },
        ],
        rankUpdatedAt: { lt: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
      },
      select: { userId: true },
    });
    for (const { userId } of stale) {
      await this.refreshRank(userId, now);
    }
    return stale.length;
  }

  /** Recomputes the 90-day Reputation and rank from the ledger; the nightly job runs it as old awards leave the window. */
  async refreshRank(userId: string, now = new Date()) {
    await this.recountRank(this.prisma, userId, now);
  }

  /** Sets reputation90d and the rank from the ledger itself, so they are exact whatever happened before. */
  private async recountRank(db: Tx, userId: string, now = new Date()) {
    const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
    const [sum, wallet] = await Promise.all([
      db.ledgerEntry.aggregate({
        where: {
          userId,
          currency: 'REPUTATION',
          reason: { in: AWARD_REASONS },
          revokedAt: null,
          createdAt: { gte: since },
        },
        _sum: { delta: true },
      }),
      db.userWallet.findUnique({
        where: { userId },
        select: { reputation: true },
      }),
    ]);
    const reputation90d = Math.max(0, sum._sum.delta ?? 0);
    await db.userWallet.update({
      where: { userId },
      data: {
        reputation90d,
        rank: rankFor(wallet?.reputation ?? 0, reputation90d),
        rankUpdatedAt: now,
      },
    });
  }

  /** Nightly check: wallets whose cached balances differ from their ledger. One statement, so it reads one consistent snapshot. */
  async verifyWalletBalances() {
    const rows = await this.prisma.$queryRaw<
      {
        userId: string;
        reputation: number;
        shards: number;
        prisms: number;
        ledgerReputation: number;
        ledgerShards: number;
        ledgerPrisms: number;
      }[]
    >`
      SELECT w."userId", w."reputation", w."shards", w."prisms",
             COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'REPUTATION'), 0)::int AS "ledgerReputation",
             COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'SHARDS'), 0)::int AS "ledgerShards",
             COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'PRISMS'), 0)::int AS "ledgerPrisms"
      FROM "user_wallets" w
      LEFT JOIN "ledger_entries" l ON l."userId" = w."userId"
      GROUP BY w."userId"
      HAVING w."reputation" <> COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'REPUTATION'), 0)
          OR w."shards" <> COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'SHARDS'), 0)
          OR w."prisms" <> COALESCE(SUM(l."delta") FILTER (WHERE l."currency" = 'PRISMS'), 0)
    `;
    return rows.map((row) => ({
      userId: row.userId,
      wallet: {
        reputation: row.reputation,
        shards: row.shards,
        prisms: row.prisms,
      },
      ledger: {
        reputation: row.ledgerReputation,
        shards: row.ledgerShards,
        prisms: row.ledgerPrisms,
      },
    }));
  }

  private async loadInteractionUsers(tx: Tx, ownerId: string, actorId: string) {
    const [owner, actor] = await Promise.all([
      tx.user.findUnique({ where: { id: ownerId }, select: { status: true } }),
      tx.user.findUnique({
        where: { id: actorId },
        select: {
          status: true,
          createdAt: true,
          _count: {
            select: {
              posts: { where: PUBLISHED_CONTENT },
              comments: { where: PUBLISHED_CONTENT },
            },
          },
        },
      }),
    ]);
    return { owner, actor };
  }

  private async canEarnFrom(
    tx: Tx,
    ownerId: string,
    giverId: string,
    now: Date,
  ): Promise<boolean> {
    const { owner, actor: giver } = await this.loadInteractionUsers(
      tx,
      ownerId,
      giverId,
    );
    if (owner?.status !== 'ACTIVE' || !giver) return false;
    return isEstablished(
      {
        status: giver.status,
        createdAt: giver.createdAt,
        postCount: giver._count.posts,
        commentCount: giver._count.comments,
      },
      trustThresholds(this.trustSecret, giverId),
      now,
    );
  }

  private async awardSteppedReputation(
    tx: Tx,
    params: {
      ownerId: string;
      giverId: string;
      day: Date;
      countField: 'likesCounted' | 'commentsCounted';
      repField: 'repFromLikes' | 'repFromComments';
      stepFn: (count: number) => number;
      reason: 'LIKE_RECEIVED' | 'COMMENT_RECEIVED';
      key: string;
      sourceType: EconomySource;
      sourceId: string;
    },
  ) {
    const {
      ownerId,
      giverId,
      day,
      countField,
      repField,
      stepFn,
      reason,
      key,
      sourceType,
      sourceId,
    } = params;
    if (!(await this.giverHasRoom(tx, ownerId, giverId, day))) return;

    const updated = await tx.dailyEarning.update({
      where: { userId_day: { userId: ownerId, day } },
      data: { [countField]: { increment: 1 } },
    });
    const reputation = stepFn(updated[countField]) - updated[repField];
    if (reputation <= 0) return;

    await tx.dailyEarning.update({
      where: { userId_day: { userId: ownerId, day } },
      data: { [repField]: { increment: reputation } },
    });
    await this.recordGiven(tx, ownerId, giverId, day, reputation);
    await this.credit(tx, {
      userId: ownerId,
      currency: 'REPUTATION',
      delta: reputation,
      reason,
      key,
      sourceType,
      sourceId,
      actorId: giverId,
    });
  }

  /** Creates and locks the day rows for these users, always in user-id order. */
  private async lockDays(tx: Tx, userIds: string[], day: Date) {
    const rows: DailyEarning[] = [];
    for (const userId of [...new Set(userIds)].sort()) {
      rows.push(
        await tx.dailyEarning.upsert({
          where: { userId_day: { userId, day } },
          create: { userId, day },
          // A no-op write, so the row is locked until this transaction ends.
          update: { userId },
        }),
      );
    }
    return userIds.map((id) => rows.find((row) => row.userId === id)!);
  }

  /** Creates and locks the wallet rows for these users, always in user-id order. */
  private async lockWallets(tx: Tx, userIds: string[]) {
    const rows: UserWallet[] = [];
    for (const userId of [...new Set(userIds)].sort()) {
      rows.push(await this.lockWallet(tx, userId));
    }
    return userIds.map((id) => rows.find((row) => row.userId === id)!);
  }

  private async lockWallet(tx: Tx, userId: string) {
    return tx.userWallet.upsert({
      where: { userId },
      create: { userId },
      update: { userId },
    });
  }

  private async giverHasRoom(
    tx: Tx,
    ownerId: string,
    giverId: string,
    day: Date,
  ): Promise<boolean> {
    const given = await tx.dailyGiverReputation.findUnique({
      where: { ownerId_giverId_day: { ownerId, giverId, day } },
    });
    return (given?.reputation ?? 0) < MAX_REPUTATION_PER_GIVER_PER_DAY;
  }

  private async recordGiven(
    tx: Tx,
    ownerId: string,
    giverId: string,
    day: Date,
    reputation: number,
  ) {
    await tx.dailyGiverReputation.upsert({
      where: { ownerId_giverId_day: { ownerId, giverId, day } },
      create: { ownerId, giverId, day, reputation },
      update: { reputation: { increment: reputation } },
    });
  }

  /** Adds `base` to today's Shard earnings and credits whatever the daily cap still allows. */
  private async creditCappedShards(
    tx: Tx,
    today: { userId: string; day: Date },
    base: number,
    award: Omit<Credit, 'userId' | 'currency' | 'delta'>,
  ) {
    const updated = await tx.dailyEarning.update({
      where: { userId_day: { userId: today.userId, day: today.day } },
      data: { baseShards: { increment: base } },
    });
    const shards = shardsToCredit(updated.baseShards, updated.creditedShards);
    if (shards <= 0) return;
    await tx.dailyEarning.update({
      where: { userId_day: { userId: today.userId, day: today.day } },
      data: { creditedShards: { increment: shards } },
    });
    await this.credit(tx, {
      ...award,
      userId: today.userId,
      currency: 'SHARDS',
      delta: shards,
    });
  }

  /** Changes one balance and writes its ledger row; the only place balances move. */
  private async credit(tx: Tx, credit: Credit) {
    const field = BALANCE_FIELD[credit.currency];
    const rankDelta =
      credit.currency === 'REPUTATION' && AWARD_REASONS.includes(credit.reason)
        ? credit.delta
        : 0;
    const current = await this.lockWallet(tx, credit.userId);
    const nextBalance = current[field] + credit.delta;
    const nextRep90d = Math.max(0, current.reputation90d + rankDelta);
    const wallet = await tx.userWallet.update({
      where: { userId: credit.userId },
      data: {
        [field]: { increment: credit.delta },
        ...(rankDelta ? { reputation90d: { increment: rankDelta } } : {}),
        ...(credit.currency === 'REPUTATION'
          ? { rank: rankFor(nextBalance, nextRep90d) }
          : {}),
      },
    });
    return tx.ledgerEntry.create({
      data: {
        userId: credit.userId,
        currency: credit.currency,
        delta: credit.delta,
        balanceAfter: wallet[field],
        reason: credit.reason,
        idempotencyKey: credit.key,
        sourceType: credit.sourceType,
        sourceId: credit.sourceId,
        actorId: credit.actorId,
        awardId: credit.awardId,
        metadata: credit.metadata,
      },
    });
  }

  private async revoke(tx: Tx, awards: LedgerEntry[], cause: RevokeCause) {
    const now = new Date();
    // Wallets in user-id order, same as every other writer.
    const ordered = [...awards].sort((a, b) =>
      a.userId === b.userId
        ? a.id.localeCompare(b.id)
        : a.userId.localeCompare(b.userId),
    );
    for (const award of ordered) {
      const claimed = await tx.ledgerEntry.updateMany({
        where: { id: award.id, revokedAt: null },
        data: { revokedAt: now, revokedCause: cause },
      });
      if (claimed.count === 0) continue;

      const field = BALANCE_FIELD[award.currency];
      const wallet = await this.lockWallet(tx, award.userId);
      // Never below 0; what could not be taken is recorded, the rest is gone (decided: no debt).
      const taken = Math.min(award.delta, wallet[field]);
      const updated = await tx.userWallet.update({
        where: { userId: award.userId },
        data: { [field]: { decrement: taken } },
      });
      await tx.ledgerEntry.update({
        where: { id: award.id },
        data: { revokedAmount: taken },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: award.userId,
          currency: award.currency,
          delta: -taken,
          balanceAfter: updated[field],
          reason: 'REVOKED',
          awardId: award.id,
          sourceType: award.sourceType,
          sourceId: award.sourceId,
          actorId: award.actorId,
          idempotencyKey: `revoke:${award.id}:${randomUUID()}`,
          metadata:
            taken < award.delta
              ? { cause, shortfall: award.delta - taken }
              : { cause },
        },
      });
    }
    await this.recountRanksOf(tx, ordered);
  }

  /** After taking back or giving back Reputation, the 90-day total and rank are recounted from the ledger. */
  private async recountRanksOf(tx: Tx, awards: LedgerEntry[]) {
    const userIds = new Set(
      awards
        .filter((award) => award.currency === 'REPUTATION')
        .map((award) => award.userId),
    );
    for (const userId of [...userIds].sort()) {
      await this.recountRank(tx, userId);
    }
  }

  private async restore(tx: Tx, awards: LedgerEntry[]) {
    const ordered = [...awards].sort((a, b) =>
      a.userId === b.userId
        ? a.id.localeCompare(b.id)
        : a.userId.localeCompare(b.userId),
    );
    for (const award of ordered) {
      const given = award.revokedAmount ?? 0;
      const claimed = await tx.ledgerEntry.updateMany({
        where: { id: award.id, revokedAt: { not: null } },
        data: { revokedAt: null, revokedCause: null, revokedAmount: null },
      });
      if (claimed.count === 0) continue;

      const field = BALANCE_FIELD[award.currency];
      await this.lockWallet(tx, award.userId);
      const updated = await tx.userWallet.update({
        where: { userId: award.userId },
        data: { [field]: { increment: given } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: award.userId,
          currency: award.currency,
          delta: given,
          balanceAfter: updated[field],
          reason: 'RESTORED',
          awardId: award.id,
          sourceType: award.sourceType,
          sourceId: award.sourceId,
          actorId: award.actorId,
          idempotencyKey: `restore:${award.id}:${randomUUID()}`,
        },
      });
    }
    await this.recountRanksOf(tx, ordered);
  }

}
