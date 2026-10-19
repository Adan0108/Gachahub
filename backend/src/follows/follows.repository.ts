import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const USER_CARD_SELECT = {
  id: true,
  name: true,
  username: true,
  image: true,
} as const;

const FOLLOW_ORDER: Prisma.UserFollowOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { followerId: 'desc' },
  { followingId: 'desc' },
];

interface FollowingIdRow {
  followingId: string;
}

@Injectable()
export class FollowsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });
  }

  find(followerId: string, followingId: string) {
    return this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });
  }

  create(
    transaction: Prisma.TransactionClient,
    followerId: string,
    followingId: string,
  ) {
    return transaction.userFollow.createMany({
      data: [
        {
          followerId,
          followingId,
        },
      ],
      skipDuplicates: true,
    });
  }

  delete(followerId: string, followingId: string) {
    return this.prisma.userFollow.deleteMany({
      where: {
        followerId,
        followingId,
      },
    });
  }

  countFollowers(userId: string) {
    return this.prisma.userFollow.count({
      where: { followingId: userId, follower: { status: 'ACTIVE' } },
    });
  }

  countFollowing(userId: string) {
    return this.prisma.userFollow.count({
      where: { followerId: userId, following: { status: 'ACTIVE' } },
    });
  }

  /** Newest follower first; `cursor` is the id of the last follower of the previous page. */
  async findFollowersPage(userId: string, take: number, cursor?: string) {
    const rows = await this.prisma.userFollow.findMany({
      where: { followingId: userId, follower: { status: 'ACTIVE' } },
      select: { follower: { select: USER_CARD_SELECT } },
      orderBy: FOLLOW_ORDER,
      take,
      ...(cursor && {
        cursor: {
          followerId_followingId: { followerId: cursor, followingId: userId },
        },
        skip: 1,
      }),
    });

    return rows.map((row) => row.follower);
  }

  /** Newest first; `cursor` is the id of the last person of the previous page. */
  async findFollowingPage(userId: string, take: number, cursor?: string) {
    const rows = await this.prisma.userFollow.findMany({
      where: { followerId: userId, following: { status: 'ACTIVE' } },
      select: { following: { select: USER_CARD_SELECT } },
      orderBy: FOLLOW_ORDER,
      take,
      ...(cursor && {
        cursor: {
          followerId_followingId: { followerId: userId, followingId: cursor },
        },
        skip: 1,
      }),
    });

    return rows.map((row) => row.following);
  }

  /** Of these people, the ones who follow this user. */
  async findFollowerIdsAmong(userId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) return [];

    const rows = await this.prisma.userFollow.findMany({
      where: { followingId: userId, followerId: { in: candidateIds } },
      select: { followerId: true },
    });

    return rows.map((row) => row.followerId);
  }

  async findFollowingIdsAmong(
    followerId: string,
    followingIds: string[],
  ): Promise<FollowingIdRow[]> {
    if (followingIds.length === 0) {
      return [];
    }

    return this.prisma.userFollow.findMany({
      where: {
        followerId,
        followingId: {
          in: followingIds,
        },
      },
      select: {
        followingId: true,
      },
    });
  }
}
