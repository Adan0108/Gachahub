import { PostsRepository } from './posts.repository';

describe('PostsRepository - Latest feed', () => {
  const prisma = {
    post: {
      findMany: jest.fn<(query: unknown) => Promise<unknown[]>>(),
    },
  };
  let repository: PostsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PostsRepository(prisma as never);
    prisma.post.findMany.mockResolvedValue([]);
  });

  it('orders the first page by the complete chronological key', async () => {
    const where = {
      status: 'PUBLISHED' as const,
      visibility: 'PUBLIC' as const,
      deletedAt: null,
    };

    await repository.findLatestPage({ where, take: 21 });

    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
  });

  it('continues strictly below createdAt and id while preserving existing filters', async () => {
    const createdAt = new Date('2026-09-29T02:00:00.000Z');
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      OR: [{ visibility: 'PUBLIC' as const }],
    };

    await repository.findLatestPage({
      where,
      cursor: {
        createdAt,
        id: 'post-2',
      },
      take: 21,
      userId: 'user-1',
    });

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          where,
          {
            OR: [
              { createdAt: { lt: createdAt } },
              {
                createdAt,
                id: { lt: 'post-2' },
              },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        game: {
          select: {
            id: true,
            name: true,
            slug: true,
            iconUrl: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        media: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
        postLikes: {
          where: { userId: 'user-1' },
          select: { userId: true },
        },
      },
    });
  });

  it('rehydrates Trending IDs with the live feed filters and current-user likes', async () => {
    const where = {
      status: 'PUBLISHED' as const,
      visibility: 'PUBLIC' as const,
      deletedAt: null,
      type: 'GUIDE' as const,
    };

    await repository.findTrendingManyByIds(
      ['post-1', 'post-2'],
      where,
      'user-1',
    );

    const calls = prisma.post.findMany.mock.calls as Array<[unknown]>;

    expect(calls[0]?.[0]).toMatchObject({
      where: {
        AND: [where, { id: { in: ['post-1', 'post-2'] } }],
      },
      include: {
        postLikes: {
          where: { userId: 'user-1' },
          select: { userId: true },
        },
      },
    });
  });

  it('rehydrates For You IDs with live eligibility and current-user likes', async () => {
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      authorId: { not: 'user-1' },
      type: 'GUIDE' as const,
      OR: [
        { visibility: 'PUBLIC' as const },
        {
          visibility: 'FOLLOWERS_ONLY' as const,
          author: { followers: { some: { followerId: 'user-1' } } },
        },
      ],
    };

    await repository.findForYouManyByIds(['post-1', 'post-2'], where, 'user-1');

    const calls = prisma.post.findMany.mock.calls as Array<[unknown]>;

    expect(calls[0]?.[0]).toMatchObject({
      where: {
        AND: [where, { id: { in: ['post-1', 'post-2'] } }],
      },
      include: {
        postLikes: {
          where: { userId: 'user-1' },
          select: { userId: true },
        },
      },
    });
  });
});
