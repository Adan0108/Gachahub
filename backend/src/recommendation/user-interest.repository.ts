import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { InterestDelta } from './recommendation.types';

@Injectable()
export class UserInterestRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Only load metadata required to update the user's interest profile.
   */
  findPostInterestSource(postId: string) {
    return this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        gameId: true,
        categoryId: true,
        type: true,

        tags: {
          select: {
            tagId: true,
          },
        },
      },
    });
  }

  /**
   * Read a bounded materialized profile.
   *
   * We fetch more than the final feed needs because decay is applied
   * afterwards in memory
   */
  findByUserId(userId: string, take = 300) {
    return this.prisma.userInterest.findMany({
      where: {
        userId,
        score: {
          gt: 0,
        },
      },
      orderBy: [
        {
          score: 'desc',
        },
        {
          updatedAt: 'desc',
        },
      ],
      take,
    });
  }

  /**
   * Applies all interest changes from one user action atomically
   *
   * Positive action:
   *  upsert/increment.
   *
   * Undo action:
   *  decrement only when the row already exist
   */
  applyDeltas(userId: string, deltas: InterestDelta[]) {
    const now = new Date();

    const operations = deltas.map((delta) => {
      if (delta.amount > 0) {
        return this.prisma.userInterest.upsert({
          where: {
            userId_entityType_entityId: {
              userId,
              entityType: delta.entityType,
              entityId: delta.entityId,
            },
          },
          create: {
            userId,
            entityType: delta.entityType,
            entityId: delta.entityId,
            score: delta.amount,
            signalCount: 1,
            lastSignalAt: now,
          },
          update: {
            score: {
              increment: delta.amount,
            },
            signalCount: {
              increment: 1,
            },
            lastSignalAt: now,
          },
        });
      }

      return this.prisma.userInterest.updateMany({
        where: {
          userId,
          entityType: delta.entityType,
          entityId: delta.entityId,
          signalCount: {
            gt: 0,
          },
        },
        data: {
          score: {
            decrement: Math.abs(delta.amount),
          },
          signalCount: {
            decrement: 1,
          },
        },
      });
    });

    return this.prisma.$transaction([
      ...operations,

      /**
       * Undo operations may reduce a materialized interest to zero.
       * Remove inactive rows so the profile does not grow indefinitely.
       */
      this.prisma.userInterest.deleteMany({
        where: {
          userId,
          OR: [
            {
              score: {
                lte: 0,
              },
            },
            {
              signalCount: {
                lte: 0,
              },
            },
          ],
        },
      }),
    ]);
  }
}
