import { BadRequestException, GoneException } from '@nestjs/common';
import type { UserInterestProfile } from '../recommendation/recommendation.types';
import type {
  ForYouFeedCandidate,
  RankedForYouFeedCandidate,
} from './feed.types';
import { encodeForYouFeedCursor } from './utils/for-you-cursor.util';

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

import { FeedService } from './feed.service';

describe('FeedService - For You', () => {
  const feedRepository = {
    findInterestCandidates: jest.fn(),
    findForYouTrendingCandidates: jest.fn(),
    findRecentForYouCandidates: jest.fn(),
    findFollowedAuthorCandidates: jest.fn(),
    findTrendingCandidates: jest.fn(),
  };

  const postsRepository = {
    findManyByIds: jest.fn(),
    findForYouManyByIds: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };

  const followsService = {
    getFollowingIdsAmong: jest.fn(),
  };

  const feedRanker = {
    rankForYou: jest.fn(),
    diversifyForYou: jest.fn(),
    rankLatestPage: jest.fn(),
    rankTrending: jest.fn(),
  };

  const userInterestService = {
    getProfile: jest.fn(),
  };

  const snapshotId = '123e4567-e89b-42d3-a456-426614174000';
  const forYouSnapshots = {
    getOrCreate: jest.fn(),
    getForContinuation: jest.fn(),
  };

  let service: FeedService;

  const personalizedProfile: UserInterestProfile = {
    games: {
      'game-wuwa': 1,
      'game-genshin': 0.5,
    },

    categories: {
      'category-build': 1,
    },

    postTypes: {
      GUIDE: 1,
    },

    tags: {
      'tag-camellya': 1,
    },

    authors: {
      'author-1': 0.7,
    },

    hasSignals: true,
  };

  const coldStartProfile: UserInterestProfile = {
    games: {},
    categories: {},
    postTypes: {},
    tags: {},
    authors: {},
    hasSignals: false,
  };

  const candidate = (
    id: string,
    overrides: Partial<ForYouFeedCandidate> = {},
  ): ForYouFeedCandidate => ({
    id,

    authorId: 'author-1',
    gameId: 'game-wuwa',
    categoryId: 'category-build',

    type: 'GUIDE',

    createdAt: new Date('2026-09-10T00:00:00.000Z'),

    reactionCount: 10,
    commentCount: 2,
    saveCount: 1,
    shareCount: 0,

    tags: [
      {
        tagId: 'tag-camellya',
      },
    ],

    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    service = new FeedService(
      feedRepository as never,
      postsRepository as never,
      followsService as never,
      feedRanker as never,
      userInterestService as never,
      {} as never,
      forYouSnapshots as never,
    );

    feedRepository.findInterestCandidates.mockResolvedValue([]);
    feedRepository.findForYouTrendingCandidates.mockResolvedValue([]);
    feedRepository.findRecentForYouCandidates.mockResolvedValue([]);
    feedRepository.findFollowedAuthorCandidates.mockResolvedValue([]);

    followsService.getFollowingIdsAmong.mockResolvedValue(new Set<string>());

    feedRanker.rankForYou.mockReturnValue([]);
    feedRanker.diversifyForYou.mockReturnValue([]);

    postsRepository.findForYouManyByIds.mockResolvedValue([]);
    forYouSnapshots.getOrCreate.mockImplementation(
      async (
        userId: string,
        _filters: unknown,
        createRanking: () => Promise<{
          postIds: string[];
          personalized: boolean;
        }>,
      ) => ({
        id: snapshotId,
        userId,
        filterKey: 'filter',
        ...(await createRanking()),
      }),
    );
  });

  it('uses personalized candidate sources when the user has interests', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(userInterestService.getProfile).toHaveBeenCalledWith('user-1');

    expect(feedRepository.findInterestCandidates).toHaveBeenCalledTimes(1);

    expect(feedRepository.findInterestCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      {
        gameIds: ['game-wuwa', 'game-genshin'],

        categoryIds: ['category-build'],

        postTypes: ['GUIDE'],

        tagIds: ['tag-camellya'],

        authorIds: ['author-1'],
      },
      200,
    );

    expect(feedRepository.findForYouTrendingCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      80,
    );

    expect(feedRepository.findRecentForYouCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      80,
    );

    expect(feedRepository.findFollowedAuthorCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      40,
    );
  });

  it('uses cold-start candidates when the user has no interests', async () => {
    userInterestService.getProfile.mockResolvedValue(coldStartProfile);

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(feedRepository.findInterestCandidates).not.toHaveBeenCalled();

    expect(feedRepository.findForYouTrendingCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      200,
    );

    expect(feedRepository.findRecentForYouCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      160,
    );

    expect(feedRepository.findFollowedAuthorCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      40,
    );
  });

  it('deduplicates posts returned by multiple candidate sources', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const post1 = candidate('post-1');
    const post2 = candidate('post-2');

    feedRepository.findInterestCandidates.mockResolvedValue([post1]);

    feedRepository.findFollowedAuthorCandidates.mockResolvedValue([
      post1,
      post2,
    ]);

    feedRepository.findForYouTrendingCandidates.mockResolvedValue([post1]);

    feedRepository.findRecentForYouCandidates.mockResolvedValue([post2]);

    let receivedCandidates: ForYouFeedCandidate[] = [];

    feedRanker.rankForYou.mockImplementation(
      (candidates: ForYouFeedCandidate[]): RankedForYouFeedCandidate[] => {
        receivedCandidates = candidates;

        return candidates.map((item) => ({
          ...item,
          score: 1,
        }));
      },
    );

    feedRanker.diversifyForYou.mockImplementation(
      (ranked: RankedForYouFeedCandidate[]): RankedForYouFeedCandidate[] =>
        ranked,
    );

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(receivedCandidates).toHaveLength(2);

    expect(receivedCandidates.map((item) => item.id)).toEqual([
      'post-1',
      'post-2',
    ]);
  });

  it('loads followed authors only for candidate authors', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const post1 = candidate('post-1', {
      authorId: 'author-1',
    });

    const post2 = candidate('post-2', {
      authorId: 'author-2',
    });

    feedRepository.findInterestCandidates.mockResolvedValue([post1, post2]);

    followsService.getFollowingIdsAmong.mockResolvedValue(
      new Set(['author-2']),
    );

    feedRanker.rankForYou.mockReturnValue([
      {
        ...post1,
        score: 1,
      },

      {
        ...post2,
        score: 0.8,
      },
    ]);

    feedRanker.diversifyForYou.mockImplementation(
      (ranked: RankedForYouFeedCandidate[]): RankedForYouFeedCandidate[] =>
        ranked,
    );

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(followsService.getFollowingIdsAmong).toHaveBeenCalledWith('user-1', [
      'author-1',
      'author-2',
    ]);

    expect(feedRanker.rankForYou).toHaveBeenCalledWith(
      expect.any(Array),
      personalizedProfile,
      new Set(['author-2']),
    );
  });

  it('starts continuation hydration at the raw cursor offset', async () => {
    const postIds = Array.from(
      { length: 30 },
      (_, index) => `post-${index + 1}`,
    );
    forYouSnapshots.getForContinuation.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds,
      personalized: true,
    });

    await service.forYou(
      {
        cursor: encodeForYouFeedCursor({ snapshotId, offset: 10 }),
        limit: 10,
      },
      'user-1',
    );

    expect(postsRepository.findForYouManyByIds).toHaveBeenCalledWith(
      postIds.slice(10, 30),
      expect.any(Object),
      'user-1',
    );
  });

  it('does not resolve following relationships when there are no candidates', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(followsService.getFollowingIdsAmong).not.toHaveBeenCalled();

    expect(feedRanker.rankForYou).toHaveBeenCalledWith(
      [],
      personalizedProfile,
      new Set(),
    );
  });

  it('rejects a cursor offset beyond its snapshot', async () => {
    forYouSnapshots.getForContinuation.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds: ['post-1'],
      personalized: true,
    });

    await expect(
      service.forYou(
        {
          cursor: encodeForYouFeedCursor({ snapshotId, offset: 2 }),
          limit: 20,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userInterestService.getProfile).not.toHaveBeenCalled();

    expect(feedRepository.findInterestCandidates).not.toHaveBeenCalled();

    expect(feedRepository.findForYouTrendingCandidates).not.toHaveBeenCalled();

    expect(feedRepository.findRecentForYouCandidates).not.toHaveBeenCalled();
  });

  it('marks the response as personalized when interest signals exist', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const result = await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(result.meta.personalized).toBe(true);
  });

  it('marks the response as non-personalized during cold start', async () => {
    userInterestService.getProfile.mockResolvedValue(coldStartProfile);

    const result = await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(result.meta.personalized).toBe(false);
  });

  it('passes the current user ID when hydrating final posts', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const post1 = candidate('post-1');

    feedRepository.findInterestCandidates.mockResolvedValue([post1]);

    const ranked: RankedForYouFeedCandidate[] = [
      {
        ...post1,
        score: 1,
      },
    ];

    feedRanker.rankForYou.mockReturnValue(ranked);

    feedRanker.diversifyForYou.mockReturnValue(ranked);

    await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(postsRepository.findForYouManyByIds).toHaveBeenCalledWith(
      ['post-1'],
      expect.any(Object),
      'user-1',
    );
  });

  it('reports hasMore when ranked candidates remain after the current page', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const candidates = Array.from(
      {
        length: 25,
      },
      (_, index) => candidate(`post-${index + 1}`),
    );

    feedRepository.findInterestCandidates.mockResolvedValue(candidates);

    const ranked: RankedForYouFeedCandidate[] = candidates.map(
      (item, index) => ({
        ...item,
        score: 100 - index,
      }),
    );

    feedRanker.rankForYou.mockReturnValue(ranked);

    feedRanker.diversifyForYou.mockReturnValue(ranked);
    postsRepository.findForYouManyByIds.mockImplementation((ids: string[]) =>
      ids.map((id) => ({ ...candidate(id), tags: [], postLikes: [] })),
    );

    const result = await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(result.meta.hasMore).toBe(true);
  });

  it('reports no more results when the ranked pool fits in the current page', async () => {
    userInterestService.getProfile.mockResolvedValue(personalizedProfile);

    const post1 = candidate('post-1');

    feedRepository.findInterestCandidates.mockResolvedValue([post1]);

    const ranked: RankedForYouFeedCandidate[] = [
      {
        ...post1,
        score: 1,
      },
    ];

    feedRanker.rankForYou.mockReturnValue(ranked);

    feedRanker.diversifyForYou.mockReturnValue(ranked);
    postsRepository.findForYouManyByIds.mockResolvedValue([
      { ...post1, tags: [], postLikes: [] },
    ]);

    const result = await service.forYou(
      {
        limit: 20,
      },
      'user-1',
    );

    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
  });

  it('reuses a current first-page snapshot without rebuilding ranking', async () => {
    forYouSnapshots.getOrCreate.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds: ['post-1'],
      personalized: true,
    });

    await service.forYou({ limit: 20 }, 'user-1');

    expect(userInterestService.getProfile).not.toHaveBeenCalled();
    expect(feedRepository.findInterestCandidates).not.toHaveBeenCalled();
    expect(feedRanker.rankForYou).not.toHaveBeenCalled();
    expect(feedRanker.diversifyForYou).not.toHaveBeenCalled();
  });

  it('continues a snapshot without rebuilding personalized ranking', async () => {
    forYouSnapshots.getForContinuation.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds: ['post-1'],
      personalized: false,
    });

    const result = await service.forYou(
      {
        limit: 20,
        cursor: encodeForYouFeedCursor({ snapshotId, offset: 1 }),
      },
      'user-1',
    );

    expect(userInterestService.getProfile).not.toHaveBeenCalled();
    expect(feedRepository.findInterestCandidates).not.toHaveBeenCalled();
    expect(feedRepository.findForYouTrendingCandidates).not.toHaveBeenCalled();
    expect(feedRepository.findRecentForYouCandidates).not.toHaveBeenCalled();
    expect(feedRepository.findFollowedAuthorCandidates).not.toHaveBeenCalled();
    expect(followsService.getFollowingIdsAmong).not.toHaveBeenCalled();
    expect(feedRanker.rankForYou).not.toHaveBeenCalled();
    expect(feedRanker.diversifyForYou).not.toHaveBeenCalled();
    expect(result.meta.personalized).toBe(false);
  });

  it('skips invalid IDs, fills the page, and restores snapshot order', async () => {
    const postIds = ['post-1', 'post-2', 'post-3', 'post-4', 'post-5'];
    forYouSnapshots.getForContinuation.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds,
      personalized: true,
    });
    postsRepository.findForYouManyByIds.mockResolvedValue([
      { ...candidate('post-5'), tags: [], postLikes: [] },
      { ...candidate('post-3'), tags: [], postLikes: [] },
      { ...candidate('post-1'), tags: [], postLikes: [] },
      { ...candidate('post-4'), tags: [], postLikes: [] },
    ]);

    const result = await service.forYou(
      {
        limit: 3,
        cursor: encodeForYouFeedCursor({ snapshotId, offset: 1 }),
      },
      'user-1',
    );

    expect(result.items.map((post) => post.id)).toEqual([
      'post-3',
      'post-4',
      'post-5',
    ]);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
  });

  it('uses raw snapshot positions across pages without duplicates', async () => {
    const postIds = [
      'post-1',
      'post-2',
      'post-3',
      'post-4',
      'post-5',
      'post-6',
    ];
    const snapshot = {
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds,
      personalized: true,
    };
    forYouSnapshots.getOrCreate.mockResolvedValue(snapshot);
    forYouSnapshots.getForContinuation.mockResolvedValue(snapshot);
    postsRepository.findForYouManyByIds.mockImplementation((ids: string[]) =>
      ids
        .filter((id) => id !== 'post-2')
        .map((id) => ({ ...candidate(id), tags: [], postLikes: [] })),
    );

    const first = await service.forYou({ limit: 3 }, 'user-1');
    const second = await service.forYou(
      { limit: 2, cursor: first.meta.nextCursor ?? undefined },
      'user-1',
    );

    expect(first.items.map((post) => post.id)).toEqual([
      'post-1',
      'post-3',
      'post-4',
    ]);
    expect(second.items.map((post) => post.id)).toEqual(['post-5', 'post-6']);
    expect(second.meta.hasMore).toBe(false);
    expect(second.meta.nextCursor).toBeNull();
  });

  it('reapplies live authenticated eligibility and the requested type', async () => {
    forYouSnapshots.getOrCreate.mockResolvedValue({
      id: snapshotId,
      userId: 'user-1',
      filterKey: 'filter',
      postIds: ['post-1'],
      personalized: true,
    });

    await service.forYou({ limit: 20, type: 'GUIDE' }, 'user-1');

    expect(postsRepository.findForYouManyByIds).toHaveBeenCalledWith(
      ['post-1'],
      {
        status: 'PUBLISHED',
        deletedAt: null,
        authorId: { not: 'user-1' },
        type: 'GUIDE',
        OR: [
          { visibility: 'PUBLIC' },
          { authorId: 'user-1', visibility: 'FOLLOWERS_ONLY' },
          {
            visibility: 'FOLLOWERS_ONLY',
            author: {
              followers: {
                some: { followerId: 'user-1' },
              },
            },
          },
        ],
      },
      'user-1',
    );
  });

  it('propagates ownership or filter mismatch rejection before hydration', async () => {
    forYouSnapshots.getForContinuation.mockRejectedValue(
      new BadRequestException('Invalid For You feed cursor'),
    );

    await expect(
      service.forYou(
        {
          limit: 20,
          cursor: encodeForYouFeedCursor({ snapshotId, offset: 1 }),
        },
        'user-2',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postsRepository.findForYouManyByIds).not.toHaveBeenCalled();
  });

  it('propagates an expired snapshot as 410 before hydration', async () => {
    forYouSnapshots.getForContinuation.mockRejectedValue(
      new GoneException('For You snapshot expired'),
    );

    await expect(
      service.forYou(
        {
          limit: 20,
          cursor: encodeForYouFeedCursor({ snapshotId, offset: 1 }),
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(postsRepository.findForYouManyByIds).not.toHaveBeenCalled();
  });
});
