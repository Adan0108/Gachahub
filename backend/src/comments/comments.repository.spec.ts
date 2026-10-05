import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { CommentsRepository } from './comments.repository';

describe('CommentsRepository.findPostIdsByCommentIds', () => {
  const prisma = { comment: { findMany: jest.fn() } };
  const repository = new CommentsRepository(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('skips the query when there are no comment ids', async () => {
    await expect(repository.findPostIdsByCommentIds([])).resolves.toEqual([]);

    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });

  it('resolves a deleted comment but never a deleted post', async () => {
    prisma.comment.findMany.mockResolvedValue([{ id: 'c1', postId: 'p1' }]);

    await expect(repository.findPostIdsByCommentIds(['c1'])).resolves.toEqual([
      { id: 'c1', postId: 'p1' },
    ]);

    expect(prisma.comment.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1'] }, post: { deletedAt: null } },
      select: { id: true, postId: true },
    });
  });
});
