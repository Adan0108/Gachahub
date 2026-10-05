import { BadRequestException } from '@nestjs/common';
import { GameFeedSortDto } from './dto/query-feed.dto';
import { PostTypeDto } from '../posts/dto/create-post.dto';
import { FeedService } from './feed.service';
import { encodeTrendingFeedCursor } from './utils/trending-cursor.util';
import type { TrendingSnapshot } from './trending/trending-snapshot.service';

jest.mock('../follows/follows.service', () => ({
  FollowsService: class FollowsService {},
}));

jest.mock('../posts/posts.repository', () => ({
  PostsRepository: class PostsRepository {},
}));

jest.mock('./feed.repository', () => ({
  FeedRepository: class FeedRepository {},
}));

jest.mock('./feed-ranker.service', () => ({
  FeedRankerService: class FeedRankerService {},
}));

jest.mock('../recommendation/user-interest.service', () => ({
  UserInterestService: class UserInterestService {},
}));

jest.mock('./trending/trending-snapshot.service', () => ({
  TRENDING_CANDIDATE_POOL: 500,
  TrendingSnapshotService: class TrendingSnapshotService {},
}));

describe('FeedService - Trending snapshots', () => {
  const snapshotId = '123e4567-e89b-42d3-a456-426614174000';
  const feedRepository = {
    findTrendingCandidates: jest.fn(),
  };
  const postsRepository = {
    findTrendingManyByIds: jest.fn(),
  };
  const feedRanker = {
    rankTrending: jest.fn(),
  };
  const trendingSnapshots = {
    getOrCreate: jest.fn(),
    getForContinuation: jest.fn(),
  };
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new FeedService(
      feedRepository as never,
      postsRepository as never,
      {} as never,
      feedRanker as never,
      {} as never,
      trendingSnapshots as never,
      {} as never,
    );

    feedRepository.findTrendingCandidates.mockResolvedValue([]);
    feedRanker.rankTrending.mockImplementation(
      (candidates: Array<{ id: string }>) =>
        candidates.map((candidate, index) => ({
          id: candidate.id,
          score: candidates.length - index,
        })),
    );
    trendingSnapshots.getOrCreate.mockImplementation(
      async (_filters: unknown, createPostIds: () => Promise<string[]>) => ({
        id: snapshotId,
        filterKey: 'filter-key',
        postIds: (await createPostIds()).slice(0, 200),
      }),
    );
    postsRepository.findTrendingManyByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          tags: [],
          postLikes: [],
        })),
      ),
    );
  });

  it('creates the first global page from one fixed 500-candidate pool', async () => {
    const candidates = Array.from({ length: 250 }, (_, index) => ({
      id: `post-${index + 1}`,
    }));
    feedRepository.findTrendingCandidates.mockResolvedValue(candidates);

    const result = await service.trending({ limit: 3 });

    expect(feedRepository.findTrendingCandidates).toHaveBeenCalledWith(
      {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      },
      500,
    );
    expect(trendingSnapshots.getOrCreate).toHaveBeenCalledWith(
      {
        gameSlug: null,
        categorySlug: null,
        type: null,
      },
      expect.any(Function),
    );
    expect(result.items.map((post) => post.id)).toEqual([
      'post-1',
      'post-2',
      'post-3',
    ]);
    expect(result.meta).toMatchObject({
      limit: 3,
      hasMore: true,
    });
    expect(typeof result.meta.nextCursor).toBe('string');
  });

  it('continues the same frozen snapshot without recomputing candidates', async () => {
    const snapshot: TrendingSnapshot = {
      id: snapshotId,
      filterKey: 'filter-key',
      postIds: Array.from({ length: 10 }, (_, index) => `post-${index + 1}`),
    };
    trendingSnapshots.getForContinuation.mockResolvedValue(snapshot);

    const result = await service.trending({
      limit: 3,
      cursor: encodeTrendingFeedCursor({ snapshotId, offset: 3 }),
    });

    expect(result.items.map((post) => post.id)).toEqual([
      'post-4',
      'post-5',
      'post-6',
    ]);
    expect(feedRepository.findTrendingCandidates).not.toHaveBeenCalled();
    expect(feedRanker.rankTrending).not.toHaveBeenCalled();
    expect(trendingSnapshots.getOrCreate).not.toHaveBeenCalled();
    expect(trendingSnapshots.getForContinuation).toHaveBeenCalledWith(
      snapshotId,
      {
        gameSlug: null,
        categorySlug: null,
        type: null,
      },
    );
  });

  it('ends after result 200 with no continuation cursor', async () => {
    const snapshot: TrendingSnapshot = {
      id: snapshotId,
      filterKey: 'filter-key',
      postIds: Array.from({ length: 200 }, (_, index) => `post-${index + 1}`),
    };
    trendingSnapshots.getOrCreate.mockResolvedValue(snapshot);

    const first = await service.trending({ limit: 100 });
    trendingSnapshots.getForContinuation.mockResolvedValue(snapshot);
    const second = await service.trending({
      limit: 100,
      cursor: first.meta.nextCursor as string,
    });

    expect(first.items).toHaveLength(100);
    expect(first.meta.hasMore).toBe(true);
    expect(second.items).toHaveLength(100);
    expect(second.meta).toEqual({
      limit: 100,
      hasMore: false,
      nextCursor: null,
    });
    expect(
      new Set([...first.items, ...second.items].map((post) => post.id)).size,
    ).toBe(200);
  });

  it('handles fewer than 200 results and an empty snapshot', async () => {
    trendingSnapshots.getOrCreate
      .mockResolvedValueOnce({
        id: snapshotId,
        filterKey: 'filter-key',
        postIds: ['post-1', 'post-2'],
      })
      .mockResolvedValueOnce({
        id: snapshotId,
        filterKey: 'filter-key',
        postIds: [],
      });

    const partial = await service.trending({ limit: 20 });
    const empty = await service.trending({ limit: 20 });

    expect(partial.items.map((post) => post.id)).toEqual(['post-1', 'post-2']);
    expect(partial.meta.hasMore).toBe(false);
    expect(partial.meta.nextCursor).toBeNull();
    expect(empty.items).toEqual([]);
    expect(empty.meta.hasMore).toBe(false);
    expect(empty.meta.nextCursor).toBeNull();
  });

  it('binds game, category, and type filters to a game snapshot', async () => {
    await service.gameFeed('genshin-impact', {
      sort: GameFeedSortDto.TRENDING,
      limit: 10,
      categorySlug: 'build',
      type: PostTypeDto.GUIDE,
    });

    expect(trendingSnapshots.getOrCreate).toHaveBeenCalledWith(
      {
        gameSlug: 'genshin-impact',
        categorySlug: 'build',
        type: 'GUIDE',
      },
      expect.any(Function),
    );
    expect(feedRepository.findTrendingCandidates).toHaveBeenCalledWith(
      {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
        game: {
          slug: 'genshin-impact',
          status: 'ACTIVE',
        },
        category: {
          slug: 'build',
          isActive: true,
        },
        type: 'GUIDE',
      },
      500,
    );
  });

  it('continues a game snapshot with the same bound filters', async () => {
    trendingSnapshots.getForContinuation.mockResolvedValue({
      id: snapshotId,
      filterKey: 'filter-key',
      postIds: ['post-1', 'post-2'],
    });

    await service.gameFeed('genshin-impact', {
      sort: GameFeedSortDto.TRENDING,
      limit: 1,
      categorySlug: 'build',
      type: PostTypeDto.GUIDE,
      cursor: encodeTrendingFeedCursor({ snapshotId, offset: 1 }),
    });

    expect(trendingSnapshots.getForContinuation).toHaveBeenCalledWith(
      snapshotId,
      {
        gameSlug: 'genshin-impact',
        categorySlug: 'build',
        type: 'GUIDE',
      },
    );
    expect(feedRepository.findTrendingCandidates).not.toHaveBeenCalled();
  });

  it('skips invalidated snapshot IDs and fills the page from later IDs', async () => {
    trendingSnapshots.getOrCreate.mockResolvedValue({
      id: snapshotId,
      filterKey: 'filter-key',
      postIds: ['deleted-1', 'post-1', 'hidden-1', 'post-2', 'post-3'],
    });
    postsRepository.findTrendingManyByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids
          .filter((id) => id.startsWith('post-'))
          .map((id) => ({ id, tags: [], postLikes: [] })),
      ),
    );

    const result = await service.trending({ limit: 2 });

    expect(result.items.map((post) => post.id)).toEqual(['post-1', 'post-2']);
    expect(result.meta.hasMore).toBe(true);
    expect(postsRepository.findTrendingManyByIds).toHaveBeenCalledWith(
      ['deleted-1', 'post-1', 'hidden-1', 'post-2', 'post-3'],
      expect.objectContaining({ visibility: 'PUBLIC' }),
      undefined,
    );
  });

  it('keeps authenticated hydration and current-user like state live', async () => {
    trendingSnapshots.getOrCreate.mockResolvedValue({
      id: snapshotId,
      filterKey: 'filter-key',
      postIds: ['post-1'],
    });
    postsRepository.findTrendingManyByIds.mockResolvedValue([
      {
        id: 'post-1',
        tags: [],
        postLikes: [{ userId: 'user-1' }],
      },
    ]);

    const result = await service.trending({ limit: 20 }, 'user-1');

    expect(postsRepository.findTrendingManyByIds).toHaveBeenCalledWith(
      ['post-1'],
      expect.objectContaining({ visibility: 'PUBLIC' }),
      'user-1',
    );
    expect(result.items[0]?.likedByCurrentUser).toBe(true);
  });

  it('rejects a malformed cursor before reading Redis or querying posts', async () => {
    await expect(
      service.trending({ limit: 20, cursor: 'not+a+cursor' }),
    ).rejects.toThrow(BadRequestException);

    expect(trendingSnapshots.getForContinuation).not.toHaveBeenCalled();
    expect(postsRepository.findTrendingManyByIds).not.toHaveBeenCalled();
  });
});
