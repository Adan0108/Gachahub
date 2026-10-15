jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PostSaveRepository, type SavedPostRow } from './post-save.repository';
import { viewablePostWhere } from '../../post-visibility/visibility-where';

describe('PostSaveRepository', () => {
  const prisma = {
    postSave: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn<
        Promise<SavedPostRow[]>,
        [Prisma.PostSaveFindManyArgs]
      >(),
    },
  };
  let repository: PostSaveRepository;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PostSaveRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = module.get(PostSaveRepository);
  });
  beforeEach(() => jest.clearAllMocks());
  it('inserts once using database duplicate suppression without modifying counts', async () => {
    prisma.postSave.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(repository.save('viewer', 'post')).resolves.toEqual({
      saved: true,
    });
    await expect(repository.save('viewer', 'post')).resolves.toEqual({
      saved: true,
    });
    expect(prisma.postSave.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'viewer', postId: 'post' }],
      skipDuplicates: true,
    });
  });
  it.each([0, 1])(
    'deletes only this user/post and succeeds for count %s',
    async (count) => {
      prisma.postSave.deleteMany.mockResolvedValue({ count });
      await expect(repository.unsave('viewer', 'post')).resolves.toEqual({
        saved: false,
      });
      expect(prisma.postSave.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'viewer', postId: 'post' },
      });
    },
  );
  it('scopes and filters before pagination and hydrates both relations in one list call', async () => {
    await repository.findSavedPage('viewer', 21);
    expect(prisma.postSave.findMany).toHaveBeenCalledTimes(1);
    const query: unknown = prisma.postSave.findMany.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      where: { userId: 'viewer', post: viewablePostWhere('viewer') },
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      take: 21,
      select: {
        post: {
          include: {
            postSaves: {
              where: { userId: 'viewer' },
              select: { userId: true },
            },
            postLikes: {
              where: { userId: 'viewer' },
              select: { userId: true },
            },
          },
        },
      },
    });
  });
  it('uses the strict compound key boundary without replacing visibility OR', async () => {
    const savedAt = new Date('2026-10-06T00:00:00.000Z');
    await repository.findSavedPage('viewer', 3, { savedAt, postId: 'post-b' });
    const query: unknown = prisma.postSave.findMany.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      where: {
        userId: 'viewer',
        post: viewablePostWhere('viewer'),
        OR: [
          { createdAt: { lt: savedAt } },
          { createdAt: savedAt, postId: { lt: 'post-b' } },
        ],
      },
    });
  });
});
