import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MediaRepository } from './media.repository';

describe('MediaRepository.findOrphanedSingleImageUploads', () => {
  const prisma = {
    mediaUpload: { findMany: jest.fn() },
    game: { findMany: jest.fn() },
  };
  const repository = new MediaRepository(prisma as unknown as PrismaService);
  const cutoff = new Date('2026-10-03T00:00:00Z');
  const upload = (id: string, secureUrl: string | null) => ({ id, secureUrl });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.game.findMany.mockResolvedValue([]);
  });

  it('selects idle ATTACHED single-image uploads that no user or game points at', async () => {
    prisma.mediaUpload.findMany.mockResolvedValue([]);

    await repository.findOrphanedSingleImageUploads(cutoff, 25);

    expect(prisma.mediaUpload.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ATTACHED',
        purpose: { in: ['AVATAR', 'GAME_ICON', 'GAME_BANNER', 'GROUP_PHOTO'] },
        updatedAt: { lt: cutoff },
        avatarFor: null,
        gameIconFor: null,
        gameBannerFor: null,
        chatGroupPhotoFor: null,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
  });

  it('skips an upload whose URL a game still shows as its icon or banner', async () => {
    prisma.mediaUpload.findMany.mockResolvedValue([
      upload('a', 'https://cdn/a.png'),
      upload('b', 'https://cdn/b.png'),
      upload('c', null),
    ]);
    prisma.game.findMany.mockResolvedValue([
      { iconUrl: 'https://cdn/a.png', bannerUrl: null },
    ]);

    const result = await repository.findOrphanedSingleImageUploads(cutoff, 50);

    expect(result.map((item) => item.id)).toEqual(['b', 'c']);
    expect(prisma.game.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { iconUrl: { in: ['https://cdn/a.png', 'https://cdn/b.png'] } },
          { bannerUrl: { in: ['https://cdn/a.png', 'https://cdn/b.png'] } },
        ],
      },
      select: { iconUrl: true, bannerUrl: true },
    });
  });

  it('keeps paging past protected uploads so they cannot starve the rest', async () => {
    prisma.mediaUpload.findMany
      .mockResolvedValueOnce([
        upload('a', 'https://cdn/a.png'),
        upload('b', 'https://cdn/b.png'),
      ])
      .mockResolvedValueOnce([upload('c', 'https://cdn/c.png')]);
    prisma.game.findMany
      .mockResolvedValueOnce([
        { iconUrl: 'https://cdn/a.png', bannerUrl: 'https://cdn/b.png' },
      ])
      .mockResolvedValueOnce([]);

    const result = await repository.findOrphanedSingleImageUploads(cutoff, 2);

    expect(result.map((item) => item.id)).toEqual(['c']);
    expect(prisma.mediaUpload.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: 'b' }, skip: 1, take: 2 }),
    );
  });

  it('never returns more than asked for', async () => {
    prisma.mediaUpload.findMany.mockResolvedValue([
      upload('a', 'https://cdn/a.png'),
      upload('b', 'https://cdn/b.png'),
    ]);

    const result = await repository.findOrphanedSingleImageUploads(cutoff, 1);

    expect(result.map((item) => item.id)).toEqual(['a']);
  });
});

// #104: a confirmation only moves INITIATED to UPLOADED, so it cannot undo a cleanup claim.
describe('MediaRepository.markUploaded', () => {
  const prisma = {
    mediaUpload: { updateMany: jest.fn(), findUnique: jest.fn() },
  };
  const repository = new MediaRepository(prisma as unknown as PrismaService);
  const params = {
    id: 'up-1',
    assetId: 'asset-1',
    secureUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/a',
    version: 1,
    format: 'bin',
    bytes: 10,
    responseSignature: 'sig',
  };

  beforeEach(() => jest.clearAllMocks());

  it('writes only while the upload is still INITIATED, and returns it', async () => {
    prisma.mediaUpload.updateMany.mockResolvedValue({ count: 1 });
    prisma.mediaUpload.findUnique.mockResolvedValue({
      id: 'up-1',
      status: 'UPLOADED',
    });

    await expect(repository.markUploaded(params)).resolves.toEqual({
      id: 'up-1',
      status: 'UPLOADED',
    });
    expect(prisma.mediaUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'up-1', status: 'INITIATED' } }),
    );
  });

  it('returns null when the upload already left INITIATED', async () => {
    prisma.mediaUpload.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.markUploaded(params)).resolves.toBeNull();
    expect(prisma.mediaUpload.findUnique).not.toHaveBeenCalled();
  });
});
