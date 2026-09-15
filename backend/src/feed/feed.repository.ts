import { Injectable } from '@nestjs/common';
import type { PostType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ForYouFeedCandidate, TrendingFeedCandidate } from './feed.types';

const trendingCandinateSelect = {
  id: true,
  createdAt: true,

  reactionCount: true,
  commentCount: true,
  saveCount: true,
  shareCount: true,
} satisfies Prisma.PostSelect;

const forYouCandidateSelect = {
  id: true,

  authorId: true,
  gameId: true,
  categoryId: true,
  type: true,

  createdAt: true,

  reactionCount: true,
  commentCount: true,
  saveCount: true,
  shareCount: true,

  tags: {
    select: {
      tagId: true,
    },
  },
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

  /**
   * Interest query
   */
  findInterestCandidates(
    where: Prisma.PostWhereInput,
    interests: {
      gameIds: string[];
      categoryIds: string[];
      postTypes: PostType[];
      tagIds: string[];
      authorIds: string[];
    },
    take: number,
  ): Promise<ForYouFeedCandidate[]> {
    const OR: Prisma.PostWhereInput[] = [];

    if (interests.gameIds.length > 0) {
      OR.push({
        gameId: {
          in: interests.gameIds,
        },
      });
    }

    if (interests.categoryIds.length > 0) {
      OR.push({
        categoryId: {
          in: interests.categoryIds,
        },
      });
    }

    if (interests.postTypes.length > 0) {
      OR.push({
        type: {
          in: interests.postTypes,
        },
      });
    }

    if (interests.tagIds.length > 0) {
      OR.push({
        tags: {
          some: {
            tagId: {
              in: interests.tagIds,
            },
          },
        },
      });
    }

    if (interests.authorIds.length > 0) {
      OR.push({
        authorId: {
          in: interests.authorIds,
        },
      });
    }

    if (OR.length === 0) {
      return Promise.resolve([]);
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.prisma.post.findMany({
      where: {
        AND: [
          where,

          {
            createdAt: {
              gte: thirtyDaysAgo,
            },
          },

          {
            OR,
          },
        ],
      },

      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],

      take,

      select: forYouCandidateSelect,
    });
  }

  /**
   * Trending source
   */
  findForYouTrendingCandidates(
    where: Prisma.PostWhereInput,
    take: number,
  ): Promise<ForYouFeedCandidate[]> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    return this.prisma.post.findMany({
      where: {
        AND: [
          where,
          {
            createdAt: {
              gte: fourteenDaysAgo,
            },
          },
        ],
      },

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
        {
          id: 'desc',
        },
      ],

      take,

      select: forYouCandidateSelect,
    });
  }

  /**
   * Recent source
   */
  findRecentForYouCandidates(
    where: Prisma.PostWhereInput,
    take: number,
  ): Promise<ForYouFeedCandidate[]> {
    return this.prisma.post.findMany({
      where,

      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],

      take,

      select: forYouCandidateSelect,
    });
  }

  /**
   * Following source
   */
  findFollowedAuthorCandidates(
    where: Prisma.PostWhereInput,
    userId: string,
    take: number,
  ): Promise<ForYouFeedCandidate[]> {
    return this.prisma.post.findMany({
      where: {
        AND: [
          where,

          {
            author: {
              followers: {
                some: {
                  followerId: userId,
                },
              },
            },
          },
        ],
      },

      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],

      take,

      select: forYouCandidateSelect,
    });
  }
}
