import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { PostsRepository } from './posts.repository';

describe('PostsRepository - Latest feed', () => {
  const prisma = {
    post: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
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
      }) as unknown,
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
        postSaves: { where: { userId: 'user-1' }, select: { userId: true } },
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

    const calls = prisma.post.findMany.mock.calls;

    expect(calls[0]?.[0]).toMatchObject({
      where: {
        AND: [
          where,
          { AND: expect.any(Array) as unknown[] },
          { id: { in: ['post-1', 'post-2'] } },
        ],
      },
      include: {
        postSaves: { where: { userId: 'user-1' }, select: { userId: true } },
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

    const calls = prisma.post.findMany.mock.calls;

    expect(calls[0]?.[0]).toMatchObject({
      where: {
        AND: [where, { id: { in: ['post-1', 'post-2'] } }],
      },
      include: {
        postSaves: { where: { userId: 'user-1' }, select: { userId: true } },
        postLikes: {
          where: { userId: 'user-1' },
          select: { userId: true },
        },
      },
    });
  });
});

describe('PostsRepository save hydration', () => {
  const prisma = {
    post: {
      findMany: jest
        .fn<Promise<unknown[]>, [Prisma.PostFindManyArgs]>()
        .mockResolvedValue([]),
      findUnique: jest
        .fn<Promise<unknown>, [Prisma.PostFindUniqueArgs]>()
        .mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  let repository: PostsRepository;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PostsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = module.get(PostsRepository);
  });
  beforeEach(() => jest.clearAllMocks());
  it.each([
    'list',
    'latest',
    'detail',
    'profile',
    'ids',
    'trending',
    'forYou',
  ] as const)(
    'hydrates scoped saves in the existing %s query',
    async (route) => {
      switch (route) {
        case 'list':
          await repository.findMany({
            where: {},
            skip: 0,
            take: 20,
            orderBy: { id: 'desc' },
            userId: 'viewer',
          });
          break;
        case 'latest':
          await repository.findLatestPage({
            where: {},
            take: 21,
            userId: 'viewer',
          });
          break;
        case 'detail':
          await repository.findViewableById('post', 'viewer');
          break;
        case 'profile':
          await repository.findByAuthorId('author', {
            page: 1,
            limit: 20,
            audience: 'public',
            userId: 'viewer',
          });
          break;
        case 'ids':
          await repository.findManyByIds(['post'], 'viewer');
          break;
        case 'trending':
          await repository.findTrendingManyByIds(['post'], {}, 'viewer');
          break;
        case 'forYou':
          await repository.findForYouManyByIds(['post'], {}, 'viewer');
          break;
      }
      const query =
        route === 'detail' ? prisma.post.findUnique : prisma.post.findMany;
      expect(query).toHaveBeenCalledTimes(1);
      const args: unknown = query.mock.calls[0]?.[0];
      expect(args).toMatchObject({
        include: {
          postSaves: { where: { userId: 'viewer' }, select: { userId: true } },
        },
      });
    },
  );
  it('does not fetch save relations for anonymous viewers', async () => {
    await repository.findViewableById('post');
    const args: unknown = prisma.post.findUnique.mock.calls[0]?.[0];
    expect(args).toMatchObject({ include: { postSaves: false } });
  });
});

describe('PostsRepository optional game lifecycle', () => {
  const post = {
    id: 'p',
    gameId: null as string | null,
    status: 'PUBLISHED',
    deletedAt: null,
  };
  const tx = {
    post: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    game: { update: jest.fn() },
  };
  const prisma = {
    $transaction: (work: (client: typeof tx) => unknown) => work(tx),
  };
  const repository = new PostsRepository(prisma as never);
  beforeEach(() => {
    jest.clearAllMocks();
    tx.post.create.mockResolvedValue(post);
    tx.post.findUniqueOrThrow.mockResolvedValue(post);
    tx.post.update.mockResolvedValue({ ...post, status: 'DRAFT' });
    tx.post.updateMany.mockResolvedValue({ count: 1 });
  });
  it.each(['PUBLISHED', 'DRAFT'])(
    'creates personal %s without a game connection/counter',
    async (status) => {
      tx.post.create.mockResolvedValue({ ...post, status });
      await repository.create(tx as never, {
        authorId: 'u',
        gameId: null,
        type: null,
        title: '',
        content: 'Personal',
        status: status as never,
      });
      const creation = tx.post.create.mock.calls[0] as [{ data: object }];
      expect(creation[0].data).not.toHaveProperty('game');
      expect(tx.game.update).not.toHaveBeenCalled();
    },
  );
  it('keeps community creation counter', async () => {
    tx.post.create.mockResolvedValue({ ...post, gameId: 'g' });
    await repository.create(tx as never, {
      authorId: 'u',
      gameId: 'g',
      title: 'Game post',
      content: 'Community',
      type: 'GENERAL',
    });
    expect(tx.game.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g' },
        data: { postCount: { increment: 1 } },
      }),
    );
  });
  it('deletes personal posts without a game counter', async () => {
    await repository.softDelete('p');
    expect(tx.game.update).not.toHaveBeenCalled();
  });
  it('changes publication status without a game counter', async () => {
    await repository.update(tx as never, {
      id: 'p',
      data: { status: 'DRAFT' },
    });
    await repository.transitionStatus(tx as never, {
      id: 'p',
      gameId: null,
      from: 'PUBLISHED',
      to: 'HIDDEN',
    });
    expect(tx.game.update).not.toHaveBeenCalled();
    expect(tx.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p', gameId: null, status: 'PUBLISHED' },
      }),
    );
  });
});
