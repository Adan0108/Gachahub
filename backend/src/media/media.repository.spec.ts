import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MediaRepository } from './media.repository';

describe('MediaRepository.findOrphanedSingleImageUploads', () => {
  const prisma = { mediaUpload: { findMany: jest.fn() } };
  const repository = new MediaRepository(prisma as unknown as PrismaService);

  it('selects idle ATTACHED single-image uploads that no user or game points at', async () => {
    const cutoff = new Date('2026-10-03T00:00:00Z');
    prisma.mediaUpload.findMany.mockResolvedValue([]);

    await repository.findOrphanedSingleImageUploads(cutoff, 25);

    expect(prisma.mediaUpload.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ATTACHED',
        purpose: { in: ['AVATAR', 'GAME_ICON', 'GAME_BANNER'] },
        updatedAt: { lt: cutoff },
        avatarFor: null,
        gameIconFor: null,
        gameBannerFor: null,
      },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    });
  });
});
