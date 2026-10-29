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
 * Row locks are taken in a fixed order (day rows by user id, then wallets) so two transactions cannot deadlock.
 */
@Injectable()
export class EconomyService {
  private readonly trustSecret =
    process.env.ECONOMY_TRUST_SECRET ?? env.betterAuthSecret ?? 'dev-only';

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

    if (await this.giverHasRoom(tx, ownerId, likerId, day)) {
      const updated = await tx.dailyEarning.update({
        where: { userId_day: { userId: ownerId, day } },
        data: { likesCounted: { increment: 1 } },
      });
      const reputation =
        reputationFromLikes(updated.likesCounted) - updated.repFromLikes;
      if (reputation > 0) {
        await tx.dailyEarning.update({
          where: { userId_day: { userId: ownerId, day } },
          data: { repFromLikes: { increment: reputation } },
        });
        await this.recordGiven(tx, ownerId, likerId, day, reputation);
        await this.credit(tx, {
          userId: ownerId,
          currency: 'REPUTATION',
          delta: reputation,
          reason: 'LIKE_RECEIVED',
          key: `${keyBase}:rep`,
          sourceType: targetType,
          sourceId: targetId,
          actorId: likerId,
        });
      }
    }

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

    const day = economyDay(now);
    const days = await this.lockDays(tx, [commenterId, postOwnerId], day);
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
      });
    }

    if (!(await this.canEarnFrom(tx, postOwnerId, commenterId, now))) return;
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
    if (await this.giverHasRoom(tx, postOwnerId, commenterId, day)) {
      const updated = await tx.dailyEarning.update({
        where: { userId_day: { userId: postOwnerId, day } },
        data: { commentsCounted: { increment: 1 } },
      });
      const reputation =
        reputationFromComments(updated.commentsCounted) -
        updated.repFromComments;
      if (reputation > 0) {
        await tx.dailyEarning.update({
          where: { userId_day: { userId: postOwnerId, day } },
          data: { repFromComments: { increment: reputation } },
        });
        await this.recordGiven(tx, postOwnerId, commenterId, day, reputation);
        await this.credit(tx, {
          userId: postOwnerId,
          currency: 'REPUTATION',
          delta: reputation,
          reason: 'COMMENT_RECEIVED',
          key: `${keyBase}:rep`,
          sourceType: 'COMMENT',
          sourceId: commentId,
          actorId: commenterId,
        });
      }
    }

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

  /** Gives back what hiding took, except awards from people who are banned now (those wait for an unban). */
  async restoreForContent(tx: Tx, sourceType: EconomySource, sourceId: string) {
    const awards = await tx.ledgerEntry.findMany({
      where: { sourceType, sourceId, revokedCause: 'CONTENT' },
    });
    const bannedActors = await this.bannedAmong(tx, awards);
    await this.restore(
      tx,
      awards.filter((award) => !bannedActors.has(award.actorId ?? '')),
    );
    const stillBlocked = awards.filter((award) =>
      bannedActors.has(award.actorId ?? ''),
    );
    if (stillBlocked.length > 0) {
      await tx.ledgerEntry.updateMany({
        where: { id: { in: stillBlocked.map((award) => award.id) } },
        data: { revokedCause: 'ACTOR' },
      });
    }
  }

  /** Takes back everything this person's likes and comments earned others (they were banned). */
  async revokeForActor(tx: Tx, actorId: string) {
    const awards = await tx.ledgerEntry.findMany({
      where: { actorId, reason: { in: AWARD_REASONS }, revokedAt: null },
    });
    await this.revoke(tx, awards, 'ACTOR');
  }

  /** Gives back what a ban took, except awards whose post or comment is hidden now (those wait for a restore). */
  async restoreForActor(tx: Tx, actorId: string) {
    const awards = await tx.ledgerEntry.findMany({
      where: { actorId, revokedCause: 'ACTOR' },
    });
    const hidden = await this.hiddenSources(tx, awards);
    const isHidden = (award: (typeof awards)[number]) =>
      hidden.has(`${award.sourceType}:${award.sourceId}`);
    await this.restore(
      tx,
      awards.filter((award) => !isHidden(award)),
    );
    const stillBlocked = awards.filter(isHidden);
    if (stillBlocked.length > 0) {
      await tx.ledgerEntry.updateMany({
        where: { id: { in: stillBlocked.map((award) => award.id) } },
        data: { revokedCause: 'CONTENT' },
      });
    }
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
          metadata: { currency, delta, reason, ledgerEntryId: entry.id },
        },
        tx,
      );
      return entry;
    });
  }

  /** Nightly: ranks of people whose old Reputation may have left the 90-day window. */
  async refreshStaleRanks(now = new Date()) {
    const stale = await this.prisma.userWallet.findMany({
      where: {
        reputation90d: { gt: 0 },
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
    const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
    const sum = await this.prisma.ledgerEntry.aggregate({
      where: {
        userId,
        currency: 'REPUTATION',
        reason: { in: AWARD_REASONS },
        revokedAt: null,
        createdAt: { gte: since },
      },
      _sum: { delta: true },
    });
    const reputation90d = sum._sum.delta ?? 0;
    await this.prisma.userWallet.update({
      where: { userId },
      data: {
        reputation90d,
        rank: rankFor(reputation90d),
        rankUpdatedAt: now,
      },
    });
  }

  private async canEarnFrom(
    tx: Tx,
    ownerId: string,
    giverId: string,
    now: Date,
  ): Promise<boolean> {
    const [owner, giver] = await Promise.all([
      tx.user.findUnique({ where: { id: ownerId }, select: { status: true } }),
      tx.user.findUnique({
        where: { id: giverId },
        select: {
          status: true,
          createdAt: true,
          _count: { select: { posts: true, comments: true } },
        },
      }),
    ]);
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
    await this.lockWallet(tx, credit.userId);
    const wallet = await tx.userWallet.update({
      where: { userId: credit.userId },
      data: {
        [field]: { increment: credit.delta },
        ...(rankDelta ? { reputation90d: { increment: rankDelta } } : {}),
      },
    });
    if (rankDelta) {
      await tx.userWallet.update({
        where: { userId: credit.userId },
        data: { rank: rankFor(wallet.reputation90d) },
      });
    }
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
    const windowStart = now.getTime() - RANK_WINDOW_DAYS * 86_400_000;
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
      const inWindow =
        award.currency === 'REPUTATION' &&
        award.createdAt.getTime() >= windowStart;
      const updated = await tx.userWallet.update({
        where: { userId: award.userId },
        data: {
          [field]: { decrement: taken },
          ...(inWindow ? { reputation90d: { decrement: award.delta } } : {}),
        },
      });
      if (inWindow) {
        await tx.userWallet.update({
          where: { userId: award.userId },
          data: { rank: rankFor(updated.reputation90d) },
        });
      }
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
  }

  private async restore(tx: Tx, awards: LedgerEntry[]) {
    const windowStart = Date.now() - RANK_WINDOW_DAYS * 86_400_000;
    const ordered = [...awards].sort((a, b) =>
      a.userId === b.userId
        ? a.id.localeCompare(b.id)
        : a.userId.localeCompare(b.userId),
    );
    for (const award of ordered) {
      const claimed = await tx.ledgerEntry.updateMany({
        where: { id: award.id, revokedAt: { not: null } },
        data: { revokedAt: null, revokedCause: null, revokedAmount: null },
      });
      if (claimed.count === 0) continue;

      const field = BALANCE_FIELD[award.currency];
      const given = award.revokedAmount ?? 0;
      const inWindow =
        award.currency === 'REPUTATION' &&
        award.createdAt.getTime() >= windowStart;
      await this.lockWallet(tx, award.userId);
      const updated = await tx.userWallet.update({
        where: { userId: award.userId },
        data: {
          [field]: { increment: given },
          ...(inWindow ? { reputation90d: { increment: award.delta } } : {}),
        },
      });
      if (inWindow) {
        await tx.userWallet.update({
          where: { userId: award.userId },
          data: { rank: rankFor(updated.reputation90d) },
        });
      }
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
  }

  private async bannedAmong(
    tx: Tx,
    awards: { actorId: string | null }[],
  ): Promise<Set<string>> {
    const actorIds = [
      ...new Set(awards.map((award) => award.actorId).filter(Boolean)),
    ] as string[];
    if (actorIds.length === 0) return new Set();
    const banned = await tx.user.findMany({
      where: { id: { in: actorIds }, status: 'BANNED' },
      select: { id: true },
    });
    return new Set(banned.map((user) => user.id));
  }

  private async hiddenSources(
    tx: Tx,
    awards: { sourceType: EconomySource | null; sourceId: string | null }[],
  ): Promise<Set<string>> {
    const ids = (type: EconomySource) => [
      ...new Set(
        awards
          .filter((award) => award.sourceType === type && award.sourceId)
          .map((award) => award.sourceId!),
      ),
    ];
    const [posts, comments] = await Promise.all([
      tx.post.findMany({
        where: { id: { in: ids('POST') }, status: 'HIDDEN' },
        select: { id: true },
      }),
      tx.comment.findMany({
        where: { id: { in: ids('COMMENT') }, status: 'HIDDEN' },
        select: { id: true },
      }),
    ]);
    return new Set([
      ...posts.map((post) => `POST:${post.id}`),
      ...comments.map((comment) => `COMMENT:${comment.id}`),
    ]);
  }
}
