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

  // upsert keeps blocking idempotent
  create(blockerId: string, blockedId: string) {
    return this.prisma.chatUserBlock.upsert({
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
    });
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
