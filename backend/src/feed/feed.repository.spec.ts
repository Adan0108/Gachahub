import { FeedRepository } from './feed.repository';

describe('FeedRepository - Trending candidates', () => {
  const prisma = {
    post: {
      findMany: jest.fn(),
    },
  };
  let repository: FeedRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.post.findMany.mockResolvedValue([]);
    repository = new FeedRepository(prisma as never);
  });

  it('selects the fixed bounded pool with the existing preselection order', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T00:00:00.000Z'));

    await repository.findTrendingCandidates(
      {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      },
      500,
    );

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
        createdAt: {
          gte: new Date('2026-09-15T00:00:00.000Z'),
        },
      },
      orderBy: [
        { reactionCount: 'desc' },
        { commentCount: 'desc' },
        { saveCount: 'desc' },
        { shareCount: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 500,
      select: {
        id: true,
        createdAt: true,
        reactionCount: true,
        commentCount: true,
        saveCount: true,
        shareCount: true,
      },
    });

    jest.useRealTimers();
  });
});
