import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
