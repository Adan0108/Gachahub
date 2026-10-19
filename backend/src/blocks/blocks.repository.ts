import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlocksRepository {
  constructor(private readonly prisma: PrismaService) {}

  // one direction, blocked user can still send, just wont notify
  find(blockerId: string, blockedId: string) {
    return this.prisma.chatUserBlock.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
    });
  }

  async findBlockedIdsAmong(blockerId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) {
      return [];
    }

    return this.prisma.chatUserBlock.findMany({
      where: {
        blockerId,
        blockedId: { in: candidateIds },
      },
      select: {
        blockedId: true,
      },
    });
  }

  /** Blocks between this person and any of the candidates, whichever of them blocked. */
  async findBlocksBetween(userId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) {
      return [];
    }

    return this.prisma.chatUserBlock.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: candidateIds } },
          { blockedId: userId, blockerId: { in: candidateIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
  }

  // upsert keeps blocking idempotent; a block also ends any follow between the two, either way
  async create(blockerId: string, blockedId: string) {
    const [block] = await this.prisma.$transaction([
      this.prisma.chatUserBlock.upsert({
        where: {
          blockerId_blockedId: {
            blockerId,
            blockedId,
          },
        },
        create: {
          blockerId,
          blockedId,
        },
        update: {},
      }),
      this.prisma.userFollow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      }),
    ]);

    return block;
  }

  delete(blockerId: string, blockedId: string) {
    return this.prisma.chatUserBlock.deleteMany({
      where: {
        blockerId,
        blockedId,
      },
    });
  }
}
