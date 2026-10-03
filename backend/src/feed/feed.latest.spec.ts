import { BadRequestException } from '@nestjs/common';
import { FeedService } from './feed.service';
import {
  decodeLatestFeedCursor,
  encodeLatestFeedCursor,
} from './utils/feed-cursor.util';

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

describe('FeedService - Latest', () => {
  const postsRepository = {
    findLatestPage: jest.fn(),
  };
  const followsService = {
    getFollowingIdsAmong: jest.fn(),
  };
  const feedRanker = {
    rankLatestPage: jest.fn(),
  };
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new FeedService(
      {} as never,
      postsRepository as never,
      followsService as never,
      feedRanker as never,
      {} as never,
      {} as never,
      {} as never,
    );

    postsRepository.findLatestPage.mockResolvedValue([]);
    followsService.getFollowingIdsAmong.mockResolvedValue(new Set<string>());
    feedRanker.rankLatestPage.mockImplementation((posts: unknown[]) => posts);
  });

  it('loads limit plus one and returns an opaque cursor from the last chronological item', async () => {
    const posts = [
      {
        id: 'post-3',
        authorId: 'author-3',
        createdAt: new Date('2026-09-29T03:00:00.000Z'),
        tags: [],
      },
      {
        id: 'post-2',
        authorId: 'author-2',
        createdAt: new Date('2026-09-29T02:00:00.000Z'),
        tags: [],
      },
      {
        id: 'post-1',
        authorId: 'author-1',
        createdAt: new Date('2026-09-29T01:00:00.000Z'),
        tags: [],
      },
    ];
    postsRepository.findLatestPage.mockResolvedValue(posts);

    const result = await service.latest({ limit: 2 });

    expect(postsRepository.findLatestPage).toHaveBeenCalledWith({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        visibility: 'PUBLIC',
      },
      cursor: undefined,
      take: 3,
      userId: undefined,
    });
    expect(result.items.map((post) => post.id)).toEqual(['post-3', 'post-2']);
    expect(result.meta).toMatchObject({
      limit: 2,
      hasMore: true,
    });
    expect(typeof result.meta.nextCursor).toBe('string');
    expect(decodeLatestFeedCursor(result.meta.nextCursor as string)).toEqual({
      createdAt: posts[1].createdAt,
      id: 'post-2',
    });
  });

  it('decodes the next request cursor and returns the last page without a cursor', async () => {
    const boundary = {
      createdAt: new Date('2026-09-29T02:00:00.000Z'),
      id: 'post-2',
    };
    postsRepository.findLatestPage.mockResolvedValue([
      {
        id: 'post-1',
        authorId: 'author-1',
        createdAt: new Date('2026-09-29T01:00:00.000Z'),
        tags: [],
      },
    ]);

    const result = await service.latest({
      limit: 2,
      cursor: encodeLatestFeedCursor(boundary),
    });

    expect(postsRepository.findLatestPage).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: boundary,
        take: 3,
      }),
    );
    expect(result.meta).toEqual({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns an empty final page without resolving follow relationships', async () => {
    const result = await service.latest({ limit: 20 }, 'user-1');

    expect(result).toEqual({
      items: [],
      meta: {
        limit: 20,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(followsService.getFollowingIdsAmong).not.toHaveBeenCalled();
  });

  it('preserves authenticated visibility and the existing social boost', async () => {
    const posts = [
      {
        id: 'post-2',
        authorId: 'author-2',
        createdAt: new Date('2026-09-29T02:00:00.000Z'),
        tags: [],
      },
      {
        id: 'post-1',
        authorId: 'author-1',
        createdAt: new Date('2026-09-29T01:00:00.000Z'),
        tags: [],
      },
    ];
    const followed = new Set(['author-1']);
    postsRepository.findLatestPage.mockResolvedValue(posts);
    followsService.getFollowingIdsAmong.mockResolvedValue(followed);
    feedRanker.rankLatestPage.mockReturnValue([posts[1], posts[0]]);

    const result = await service.latest({ limit: 20 }, 'user-1');

    expect(postsRepository.findLatestPage).toHaveBeenCalledWith({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        OR: [
          { visibility: 'PUBLIC' },
          { authorId: 'user-1', visibility: 'FOLLOWERS_ONLY' },
          {
            visibility: 'FOLLOWERS_ONLY',
            author: {
              followers: {
                some: {
                  followerId: 'user-1',
                },
              },
            },
          },
        ],
      },
      cursor: undefined,
      take: 21,
      userId: 'user-1',
    });
    expect(followsService.getFollowingIdsAmong).toHaveBeenCalledWith('user-1', [
      'author-2',
      'author-1',
    ]);
    expect(feedRanker.rankLatestPage).toHaveBeenCalledWith(posts, followed);
    expect(result.items.map((post) => post.id)).toEqual(['post-1', 'post-2']);
  });

  it('applies the cursor and existing filters to game-scoped Latest', async () => {
    const cursor = encodeLatestFeedCursor({
      createdAt: new Date('2026-09-29T02:00:00.000Z'),
      id: 'post-2',
    });

    await service.gameFeed(
      'genshin-impact',
      {
        sort: 'latest',
        limit: 10,
        cursor,
        categorySlug: 'builds',
        type: 'GUIDE',
      },
      undefined,
    );

    expect(postsRepository.findLatestPage).toHaveBeenCalledWith({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        visibility: 'PUBLIC',
        game: {
          slug: 'genshin-impact',
          status: 'ACTIVE',
        },
        category: {
          slug: 'builds',
          isActive: true,
        },
        type: 'GUIDE',
      },
      cursor: {
        createdAt: new Date('2026-09-29T02:00:00.000Z'),
        id: 'post-2',
      },
      take: 11,
      userId: undefined,
    });
  });

  it('rejects a malformed cursor before querying posts', async () => {
    await expect(
      service.latest({ limit: 20, cursor: 'not+a+cursor' }),
    ).rejects.toThrow(BadRequestException);

    expect(postsRepository.findLatestPage).not.toHaveBeenCalled();
  });
});
