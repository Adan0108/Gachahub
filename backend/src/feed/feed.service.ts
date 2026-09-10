import { Injectable, BadRequestException } from '@nestjs/common';
import type { PostType, Prisma } from '../generated/prisma/client';
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
import { UserInterestService } from '../recommendation/user-interest.service';
import type { ForYouFeedCandidate } from './feed.types';
import type { UserInterestProfile } from '../recommendation/recommendation.types';

const FOR_YOU_MAX_CANDIDATES = 400;

const FOR_YOU_INTEREST_TAKE = 200;
const FOR_YOU_TRENDING_TAKE = 80;
const FOR_YOU_RECENT_TAKE = 80;
const FOR_YOU_FOLLOWING_TAKE = 40;

@Injectable()
export class FeedService {
  constructor(
    private readonly feedRepository: FeedRepository,

    private readonly postsRepository: PostsRepository,

    private readonly followsService: FollowsService,

    private readonly feedRanker: FeedRankerService,

    private readonly userInterestService: UserInterestService,
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
   * Builds the personalized For You feed for the current user.
   *
   * Flow:
   * 1. Load the user's materialized interest profile.
   * 2. Select the strongest interests used for candidate retrieval.
   * 3. Fetch candidates from multiple sources:
   *    - interest matches
   *    - followed authors
   *    - trending posts
   *    - recent posts
   * 4. Merge and deduplicate the candidate pool.
   * 5. Resolve social relationships for candidate authors.
   * 6. Rank candidates using interest, engagement, freshness, and social signals.
   * 7. Apply diversity rules to reduce repetitive authors and games.
   * 8. Paginate the ranked candidate list.
   * 9. Hydrate only the selected post IDs with full post data.
   *
   * Users without interest signals use a cold-start mix with more
   * trending and recent candidates instead of personalized interest candidates.
   */
  async forYou(query: QueryFeedDto, userId: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const start = (page - 1) * limit;

    if (start >= FOR_YOU_MAX_CANDIDATES) {
      throw new BadRequestException('For You feed pagination limit exceeded');
    }

    const profile = await this.userInterestService.getProfile(userId);

    const strongest = this.selectStrongestInterests(profile);

    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      deletedAt: null,

      // Do not recommend the user's own posts.
      authorId: {
        not: userId,
      },

      ...this.buildLatestVisibilityWhere(userId),

      ...(query.type
        ? {
            type: query.type,
          }
        : {}),
    };

    const [
      interestCandidates,
      trendingCandidates,
      recentCandidates,
      followedCandidates,
    ] = await Promise.all([
      profile.hasSignals
        ? this.feedRepository.findInterestCandidates(
            where,
            strongest,
            FOR_YOU_INTEREST_TAKE,
          )
        : Promise.resolve([]),

      this.feedRepository.findForYouTrendingCandidates(
        where,
        profile.hasSignals ? FOR_YOU_TRENDING_TAKE : 200,
      ),

      this.feedRepository.findRecentForYouCandidates(
        where,
        profile.hasSignals ? FOR_YOU_RECENT_TAKE : 160,
      ),

      this.feedRepository.findFollowedAuthorCandidates(
        where,
        userId,
        FOR_YOU_FOLLOWING_TAKE,
      ),
    ]);

    const candidates = this.mergeCandidates([
      interestCandidates,
      followedCandidates,
      trendingCandidates,
      recentCandidates,
    ]);

    const followedAuthorIds =
      candidates.length > 0
        ? await this.followsService.getFollowingIdsAmong(
            userId,
            candidates.map((candidate) => candidate.authorId),
          )
        : new Set<string>();

    const ranked = this.feedRanker.rankForYou(
      candidates,
      profile,
      followedAuthorIds,
    );

    const diversified = this.feedRanker.diversifyForYou(ranked);

    const selectedIds = diversified
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

        hasMore: start + limit < diversified.length,

        personalized: profile.hasSignals,
      },
    };
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
    const maxCandidates = 500;

    const candidateLimit = Math.min(
      maxCandidates,
      Math.max(100, page * limit * 5),
    );

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

    if (start >= maxCandidates) {
      throw new BadRequestException('Trending feed pagination limit exceeded');
    }

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

  /**
   * Selects the strongest interest signals from the user's profile
   * for candidate retrieval.
   *
   * Only the top interests from each entity type are kept so the
   * database query stays focused and does not grow too large.
   */
  private selectStrongestInterests(profile: UserInterestProfile) {
    return {
      gameIds: this.topInterestIds(profile.games, 5),

      categoryIds: this.topInterestIds(profile.categories, 15),

      postTypes: this.topInterestIds(profile.postTypes, 5) as PostType[],

      tagIds: this.topInterestIds(profile.tags, 30),

      authorIds: this.topInterestIds(profile.authors, 20),
    };
  }

  /**
   * Returns the IDs with the highest interest scores.
   *
   * Entries are sorted by score descending, with the ID used as a
   * deterministic tie-breaker when two interests have the same score.
   */
  private topInterestIds(values: Record<string, number>, take: number) {
    return Object.entries(values)
      .sort((a, b) => {
        if (a[1] !== b[1]) {
          return b[1] - a[1];
        }

        return a[0].localeCompare(b[0]);
      })
      .slice(0, take)
      .map(([id]) => id);
  }

  /**
   * Merges candidate lists from multiple retrieval sources
   * while removing duplicate posts.
   *
   * The first occurrence of each post is preserved, so the
   * source order determines which candidate instance is kept.
   */
  private mergeCandidates(sources: ForYouFeedCandidate[][]) {
    const unique = new Map<string, ForYouFeedCandidate>();

    for (const source of sources) {
      for (const candidate of source) {
        if (!unique.has(candidate.id)) {
          unique.set(candidate.id, candidate);
        }
      }
    }

    return [...unique.values()];
  }
}
