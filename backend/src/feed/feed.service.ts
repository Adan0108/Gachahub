import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { FollowsService } from '../follows/follows.service';
import { formatPost } from '../posts/post.mapper';
import { PostsRepository } from '../posts/posts.repository';
import {
  GameFeedSortDto,
  QueryFeedDto,
  QueryGameFeedDto,
} from './dto/query-feed.dto';
import { FeedRankerService } from './feed-ranker.service';
import { FeedRepository } from './feed.repository';

@Injectable()
export class FeedService {
  constructor(
    private readonly feedRepository: FeedRepository,

    private readonly postsRepository: PostsRepository,

    private readonly followsService: FollowsService,

    private readonly feedRanker: FeedRankerService,
  ) {}

  /**
   * Global Latest feed.
   *
   * Anonymous:
   * - PUBLIC posts only
   *
   * Logged in:
   * - PUBLIC posts
   * - FOLLOWERS_ONLY posts from users you follow
   *
   * Followed authors receive a small ranking boost.
   */
  latest(query: QueryFeedDto, userId?: string) {
    return this.latestInternal({
      query,
      userId,
    });
  }

  /**
   * Global Trending.
   *
   * This intentionally stays global instead
   * of using follow relationships.
   */
  trending(query: QueryFeedDto, userId?: string) {
    return this.trendingInternal({
      query,
      userId,
    });
  }

  /**
   * Game community feed.
   *
   * latest:
   *   game scoped + social boost
   *
   * trending:
   *   game scoped global popularity
   */
  gameFeed(gameSlug: string, query: QueryGameFeedDto, userId?: string) {
    const sort = query.sort ?? GameFeedSortDto.LATEST;

    if (sort === GameFeedSortDto.TRENDING) {
      return this.trendingInternal({
        query,
        userId,
        gameSlug,
        categorySlug: query.categorySlug,
      });
    }

    return this.latestInternal({
      query,
      userId,
      gameSlug,
      categorySlug: query.categorySlug,
    });
  }

  private async latestInternal(params: {
    query: QueryFeedDto;
    userId?: string;
    gameSlug?: string;
    categorySlug?: string;
  }) {
    const { query, userId, gameSlug, categorySlug } = params;

    const page = query.page ?? 1;

    const limit = query.limit ?? 20;

    const skip = (page - 1) * limit;

    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      deletedAt: null,

      ...this.buildLatestVisibilityWhere(userId),

      ...(gameSlug
        ? {
            game: {
              slug: gameSlug,
              status: 'ACTIVE',
            },
          }
        : {}),

      ...(categorySlug
        ? {
            category: {
              slug: categorySlug,
              isActive: true,
            },
          }
        : {}),

      ...(query.type
        ? {
            type: query.type,
          }
        : {}),
    };

    const [posts, total] = await Promise.all([
      this.postsRepository.findMany({
        where,
        skip,
        take: limit,

        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        userId,
      }),

      this.postsRepository.count(where),
    ]);

    let followedAuthorIds = new Set<string>();

    if (userId && posts.length > 0) {
      followedAuthorIds = await this.followsService.getFollowingIdsAmong(
        userId,
        posts.map((post) => post.authorId),
      );
    }

    const rankedPosts = this.feedRanker.rankLatestPage(
      posts,
      followedAuthorIds,
    );

    return {
      items: rankedPosts.map((post) => formatPost(post)),

      meta: {
        page,
        limit,
        total,

        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async trendingInternal(params: {
    query: QueryFeedDto;
    userId?: string;
    gameSlug?: string;
    categorySlug?: string;
  }) {
    const { query, userId, gameSlug, categorySlug } = params;

    const page = query.page ?? 1;

    const limit = query.limit ?? 20;

    /*
     * We rank a bounded pool rather than
     * reading every post from the database.
     */
    const candidateLimit = Math.min(500, Math.max(100, page * limit * 5));

    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',

      /*
       * Trending is a global/community concept,
       * so private/follower-only posts are excluded.
       */
      visibility: 'PUBLIC',

      deletedAt: null,

      ...(gameSlug
        ? {
            game: {
              slug: gameSlug,
              status: 'ACTIVE',
            },
          }
        : {}),

      ...(categorySlug
        ? {
            category: {
              slug: categorySlug,
              isActive: true,
            },
          }
        : {}),

      ...(query.type
        ? {
            type: query.type,
          }
        : {}),
    };

    const candidates = await this.feedRepository.findTrendingCandidates(
      where,
      candidateLimit,
    );

    const ranked = this.feedRanker.rankTrending(candidates);

    const start = (page - 1) * limit;

    const selectedIds = ranked
      .slice(start, start + limit)
      .map((candidate) => candidate.id);

    const posts = await this.postsRepository.findManyByIds(selectedIds, userId);

    return {
      items: this.orderPostsByIds(posts, selectedIds).map((post) =>
        formatPost(post),
      ),

      meta: {
        page,
        limit,

        candidateCount: candidates.length,

        hasMore: start + limit < ranked.length,
      },
    };
  }

  /**
   * Visibility policy for Latest.
   */
  private buildLatestVisibilityWhere(userId?: string): Prisma.PostWhereInput {
    if (!userId) {
      return {
        visibility: 'PUBLIC',
      };
    }

    return {
      OR: [
        {
          visibility: 'PUBLIC',
        },

        /*
         * Allow the user's own followers-only posts.
         */
        {
          authorId: userId,
          visibility: 'FOLLOWERS_ONLY',
        },

        /*
         * Allow FOLLOWERS_ONLY content
         * from authors the current user follows.
         */
        {
          visibility: 'FOLLOWERS_ONLY',

          author: {
            followers: {
              some: {
                followerId: userId,
              },
            },
          },
        },
      ],
    };
  }

  /**
   * Prisma IN queries do not guarantee
   * the same order as selectedIds.
   *
   * Restore the ranking after hydration.
   */
  private orderPostsByIds<
    T extends {
      id: string;
    },
  >(posts: T[], selectedIds: string[]) {
    const postMap = new Map(posts.map((post) => [post.id, post]));

    return selectedIds
      .map((id) => postMap.get(id))
      .filter((post): post is T => post !== undefined);
  }
}
