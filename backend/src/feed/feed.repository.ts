import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TrendingFeedCandidate } from './feed.types';

const trendingCandinateSelect = {
  id: true,
  createdAt: true,

  reactionCount: true,
  commentCount: true,
  saveCount: true,
  shareCount: true,
} satisfies Prisma.PostSelect;

@Injectable()
export class FeedRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trending only nêds lightweigh fields
   *
   * Full post information is hydrated after ranking
   */
  findTrendingCandidates(
    where: Prisma.PostWhereInput,
    take: number,
  ): Promise<TrendingFeedCandidate[]> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    return this.prisma.post.findMany({
      where: {
        ...where,

        createdAt: {
          gte: fourteenDaysAgo,
        },
      },

      /**
       * Cheap preselection.
       *
       * Final Trending score is calculated
       * inside FeedRanker Service
       */
      orderBy: [
        {
          reactionCount: 'desc',
        },
        {
          commentCount: 'desc',
        },
        {
          saveCount: 'desc',
        },
        {
          shareCount: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],

      take,

      select: trendingCandinateSelect,
    });
  }
}
