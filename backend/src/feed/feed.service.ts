import { Injectable, BadRequestException } from '@nestjs/common';
import type { PostType, Prisma } from '../generated/prisma/client';
import { FollowsService } from '../follows/follows.service';
import { formatPost } from '../posts/post.mapper';
import { PostsRepository } from '../posts/posts.repository';
import {
  GameFeedSortDto,
  QueryForYouFeedDto,
  QueryGameFeedDto,
  QueryLatestFeedDto,
  QueryTrendingFeedDto,
} from './dto/query-feed.dto';
import { FeedRankerService } from './feed-ranker.service';
import { FeedRepository } from './feed.repository';
import { UserInterestService } from '../recommendation/user-interest.service';
import type { ForYouFeedCandidate } from './feed.types';
import type { UserInterestProfile } from '../recommendation/recommendation.types';
import {
  decodeLatestFeedCursor,
  encodeLatestFeedCursor,
} from './utils/feed-cursor.util';
import {
  TRENDING_CANDIDATE_POOL,
  TrendingSnapshotService,
  type TrendingSnapshotFilters,
} from './trending/trending-snapshot.service';
import {
  decodeTrendingFeedCursor,
  encodeTrendingFeedCursor,
} from './utils/trending-cursor.util';
import {
  ForYouSnapshotService,
  type ForYouSnapshotFilters,
} from './for-you/for-you-snapshot.service';
import {
  decodeForYouFeedCursor,
  encodeForYouFeedCursor,
} from './utils/for-you-cursor.util';

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

    private readonly trendingSnapshots: TrendingSnapshotService,

    private readonly forYouSnapshots: ForYouSnapshotService,
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
  latest(query: QueryLatestFeedDto, userId?: string) {
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
  trending(query: QueryTrendingFeedDto, userId?: string) {
    return this.trendingInternal({
      query,
      userId,
    });
  }

  /**
   * Builds or continues the personalized For You feed for the current user.
   *
   * First request:
   * 1. Reuse the current user/filter snapshot when it is still available.
   * 2. Otherwise load the user's materialized interest profile.
   * 3. Select the strongest interests used for candidate retrieval.
   * 4. Fetch candidates from multiple sources:
   *    - interest matches
   *    - followed authors
   *    - trending posts
   *    - recent posts
   * 5. Merge, rank, diversify, and freeze the ordered IDs in Redis.
   *
   * Continuation:
   * 1. Reuse the exact user-bound snapshot without rebuilding its ranking.
   * 2. Live-revalidate posts and scan forward through invalid IDs.
   * 3. Return an opaque cursor containing the next raw snapshot position.
   *
   * Users without interest signals use a cold-start mix with more
   * trending and recent candidates instead of personalized interest candidates.
   */
  async forYou(query: QueryForYouFeedDto, userId: string) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor
      ? decodeForYouFeedCursor(query.cursor)
      : undefined;
    const filters: ForYouSnapshotFilters = {
      type: query.type ?? null,
    };
    const snapshot = cursor
      ? await this.forYouSnapshots.getForContinuation(
          cursor.snapshotId,
          userId,
          filters,
        )
      : await this.forYouSnapshots.getOrCreate(userId, filters, () =>
          this.buildForYouSnapshotRanking(userId, query.type),
        );
    const offset = cursor?.offset ?? 0;

    if (offset > snapshot.postIds.length) {
      throw new BadRequestException('Invalid For You feed cursor');
    }

    const where = this.buildForYouWhere(userId, query.type);
    const page = await this.hydrateForYouSnapshotPage({
      postIds: snapshot.postIds,
      offset,
      limit,
      where,
      userId,
    });

    return {
      items: page.posts.map((post) => formatPost(post)),

      meta: {
        limit,
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && page.nextOffset !== null
            ? encodeForYouFeedCursor({
                snapshotId: snapshot.id,
                offset: page.nextOffset,
              })
            : null,
        personalized: snapshot.personalized,
      },
    };
  }

  /**
   * Executes the existing candidate, ranking, and diversity pipeline exactly
   * once when a new For You snapshot is required.
   */
  private async buildForYouSnapshotRanking(userId: string, type?: PostType) {
    const profile = await this.userInterestService.getProfile(userId);
    const strongest = this.selectStrongestInterests(profile);
    const where = this.buildForYouWhere(userId, type);
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

    return {
      postIds: diversified.map((candidate) => candidate.id),
      personalized: profile.hasSignals,
    };
  }

  /**
   * Reapplies live For You eligibility while scanning raw snapshot positions
   * until a full page and one extra valid post have been found.
   */
  private async hydrateForYouSnapshotPage(params: {
    postIds: string[];
    offset: number;
    limit: number;
    where: Prisma.PostWhereInput;
    userId: string;
  }) {
    const { postIds, offset, limit, where, userId } = params;
    const hydrated: Array<{
      index: number;
      post: Awaited<ReturnType<PostsRepository['findForYouManyByIds']>>[number];
    }> = [];
    let scanOffset = offset;

    while (scanOffset < postIds.length && hydrated.length <= limit) {
      const remainingNeeded = limit + 1 - hydrated.length;
      const chunkSize = Math.max(20, remainingNeeded);
      const chunkEnd = Math.min(postIds.length, scanOffset + chunkSize);
      const chunkIds = postIds.slice(scanOffset, chunkEnd);
      const posts = await this.postsRepository.findForYouManyByIds(
        chunkIds,
        where,
        userId,
      );
      const postMap = new Map(posts.map((post) => [post.id, post] as const));

      for (let index = scanOffset; index < chunkEnd; index += 1) {
        const postId = postIds[index];
        const post = postId ? postMap.get(postId) : undefined;

        if (post) {
          hydrated.push({ index, post });
        }
      }

      scanOffset = chunkEnd;
    }

    const selected = hydrated.slice(0, limit);
    const last = selected[selected.length - 1];
    const hasMore = hydrated.length > limit;

    return {
      posts: selected.map((item) => item.post),
      hasMore,
      nextOffset: hasMore && last ? last.index + 1 : null,
    };
  }

  /**
   * Defines both candidate-time and hydration-time For You eligibility.
   */
  private buildForYouWhere(
    userId: string,
    type?: PostType,
  ): Prisma.PostWhereInput {
    return {
      status: 'PUBLISHED',
      deletedAt: null,
      authorId: {
        not: userId,
      },
      ...this.buildLatestVisibilityWhere(userId),
      ...(type ? { type } : {}),
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

  /**
   * Loads a chronological Latest page and preserves the existing social boost
   * inside that selected page. The continuation key is taken before ranking so
   * page boundaries always follow createdAt DESC, id DESC.
   */
  private async latestInternal(params: {
    query: QueryLatestFeedDto | QueryGameFeedDto;
    userId?: string;
    gameSlug?: string;
    categorySlug?: string;
  }) {
    const { query, userId, gameSlug, categorySlug } = params;

    const limit = query.limit ?? 20;
    const cursor = query.cursor
      ? decodeLatestFeedCursor(query.cursor)
      : undefined;

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

    const rows = await this.postsRepository.findLatestPage({
      where,
      cursor,
      take: limit + 1,
      userId,
    });

    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const lastPost = posts[posts.length - 1];

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
        limit,
        hasMore,
        nextCursor:
          hasMore && lastPost
            ? encodeLatestFeedCursor({
                createdAt: lastPost.createdAt,
                id: lastPost.id,
              })
            : null,
      },
    };
  }

  /**
   * Builds the global/community-ranked Trending feed without follow-based
   * personalization.
   *
   * Flow:
   * 1. Decode any Trending continuation cursor and build the effective filters.
   * 2. For a first page, derive the filter-specific snapshot identity and reuse
   *    the current Redis snapshot when available.
   * 3. Otherwise fetch up to TRENDING_CANDIDATE_POOL candidates, rank them with
   *    the existing Trending ranker, and keep at most TRENDING_MAX_RESULTS.
   * 4. Store the frozen ranking as ordered post IDs in a short-lived Redis
   *    snapshot; full post objects are never cached.
   * 5. For continuation, load the exact cursor snapshot without reranking and
   *    treat its offset as the next raw position in that snapshot.
   * 6. Hydrate IDs from PostgreSQL with live visibility and post-state filters,
   *    scanning farther when invalid posts would otherwise shorten the page.
   * 7. Restore the frozen snapshot order after hydration so ranking stays stable
   *    while returned post data remains fresh.
   * 8. Return hasMore and an opaque cursor carrying the same snapshot identity
   *    and the next raw offset.
   *
   * The current-snapshot TTL controls first-page reuse, while the longer snapshot
   * TTL allows existing cursors to continue after a newer ranking is published.
   */
  private async trendingInternal(params: {
    query: QueryTrendingFeedDto | QueryGameFeedDto;
    userId?: string;
    gameSlug?: string;
    categorySlug?: string;
  }) {
    const { query, userId, gameSlug, categorySlug } = params;

    const limit = query.limit ?? 20;
    const cursor = query.cursor
      ? decodeTrendingFeedCursor(query.cursor)
      : undefined;

    const filters: TrendingSnapshotFilters = {
      gameSlug: gameSlug ?? null,
      categorySlug: categorySlug ?? null,
      type: query.type ?? null,
    };

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

    const snapshot = cursor
      ? await this.trendingSnapshots.getForContinuation(
          cursor.snapshotId,
          filters,
        )
      : await this.trendingSnapshots.getOrCreate(filters, async () => {
          const candidates = await this.feedRepository.findTrendingCandidates(
            where,
            TRENDING_CANDIDATE_POOL,
          );

          return this.feedRanker
            .rankTrending(candidates)
            .map((candidate) => candidate.id);
        });

    const offset = cursor?.offset ?? 0;

    if (offset > snapshot.postIds.length) {
      throw new BadRequestException('Invalid Trending feed cursor');
    }

    const page = await this.hydrateTrendingSnapshotPage({
      postIds: snapshot.postIds,
      offset,
      limit,
      where,
      userId,
    });

    return {
      items: page.posts.map((post) => formatPost(post)),

      meta: {
        limit,
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && page.nextOffset !== null
            ? encodeTrendingFeedCursor({
                snapshotId: snapshot.id,
                offset: page.nextOffset,
              })
            : null,
      },
    };
  }

  /**
   * Hydrates one Trending page while scanning past snapshot IDs that are no
   * longer visible. One extra valid post is resolved to calculate hasMore
   * without exposing stale or unnecessarily short pages.
   */
  private async hydrateTrendingSnapshotPage(params: {
    postIds: string[];
    offset: number;
    limit: number;
    where: Prisma.PostWhereInput;
    userId?: string;
  }) {
    const { postIds, offset, limit, where, userId } = params;
    const hydrated: Array<{
      index: number;
      post: Awaited<
        ReturnType<PostsRepository['findTrendingManyByIds']>
      >[number];
    }> = [];
    let scanOffset = offset;

    while (scanOffset < postIds.length && hydrated.length <= limit) {
      const remainingNeeded = limit + 1 - hydrated.length;
      const chunkSize = Math.max(20, remainingNeeded);
      const chunkEnd = Math.min(postIds.length, scanOffset + chunkSize);
      const chunkIds = postIds.slice(scanOffset, chunkEnd);
      const posts = await this.postsRepository.findTrendingManyByIds(
        chunkIds,
        where,
        userId,
      );
      const postMap = new Map(posts.map((post) => [post.id, post] as const));

      for (let index = scanOffset; index < chunkEnd; index += 1) {
        const postId = postIds[index];
        const post = postId ? postMap.get(postId) : undefined;

        if (post) {
          hydrated.push({ index, post });
        }
      }

      scanOffset = chunkEnd;
    }

    const selected = hydrated.slice(0, limit);
    const last = selected[selected.length - 1];
    const hasMore = hydrated.length > limit;

    return {
      posts: selected.map((item) => item.post),
      hasMore,
      nextOffset: hasMore && last ? last.index + 1 : null,
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
