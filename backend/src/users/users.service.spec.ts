import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const blocksService = {
    isBlocked: jest.fn(),
  };

  const repository = {
    searchByName: jest.fn(),
    findPickableById: jest.fn(),
  };
  const limiter = { assertNotRateLimited: jest.fn() };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as any,
      blocksService as any,
      repository as any,
      limiter as any,
    );
  });

  describe('getPublicProfile', () => {
    const profileFields = {
      id: 'user-2',
      name: 'Yumemi',
      image: null,
      createdAt: new Date('2024-01-01'),
    };

    it('throws when the user does not exist or is not active', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.getPublicProfile('missing-user', 'viewer-1'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'missing-user', status: 'ACTIVE' },
        }),
      );
      expect(blocksService.isBlocked).not.toHaveBeenCalled();
    });

    it('includes isBlockedByMe when the viewer has blocked this user', async () => {
      prisma.user.findFirst.mockResolvedValue(profileFields);
      blocksService.isBlocked.mockResolvedValue(true);

      const result = await service.getPublicProfile('user-2', 'viewer-1');

      expect(blocksService.isBlocked).toHaveBeenCalledWith(
        'viewer-1',
        'user-2',
      );
      expect(result).toEqual({ ...profileFields, isBlockedByMe: true });
    });

    it('returns isBlockedByMe: false when the viewer has not blocked this user', async () => {
      prisma.user.findFirst.mockResolvedValue(profileFields);
      blocksService.isBlocked.mockResolvedValue(false);

      const result = await service.getPublicProfile('user-2', 'viewer-1');

      expect(result.isBlockedByMe).toBe(false);
    });

    it('never checks blocks for an anonymous viewer', async () => {
      prisma.user.findFirst.mockResolvedValue(profileFields);

      const result = await service.getPublicProfile('user-2');

      expect(blocksService.isBlocked).not.toHaveBeenCalled();
      expect(result.isBlockedByMe).toBe(false);
    });

    it('never checks blocks when viewing your own profile', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...profileFields,
        id: 'viewer-1',
      });

      const result = await service.getPublicProfile('viewer-1', 'viewer-1');

      expect(blocksService.isBlocked).not.toHaveBeenCalled();
      expect(result.isBlockedByMe).toBe(false);
    });
  });

  describe('getMe', () => {
    it('throws when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('user-1')).rejects.toThrow(NotFoundException);
    });

    it('reads live from the database instead of trusting a cached session', async () => {
      const liveRow = { id: 'user-1', onboarded: true, username: 'Mado-123' };
      prisma.user.findUnique.mockResolvedValue(liveRow);

      await expect(service.getMe('user-1')).resolves.toEqual(liveRow);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });
  });

  describe('completeOnboarding', () => {
    const dto = { name: 'Mado', username: 'Mado-123' };

    it('throws when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a second claim once already onboarded', async () => {
      prisma.user.findUnique.mockResolvedValue({ onboarded: true });

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('sets name, username and onboarded in one update', async () => {
      prisma.user.findUnique.mockResolvedValue({ onboarded: false });
      prisma.user.update.mockResolvedValue({ id: 'user-1', ...dto });

      await service.completeOnboarding('user-1', dto);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: dto.name, username: dto.username, onboarded: true },
      });
    });

    it('maps a taken handle (P2002) to a 409 instead of leaking the Prisma error', async () => {
      prisma.user.findUnique.mockResolvedValue({ onboarded: false });
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['username'] },
        }),
      );

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not swallow an unrelated error', async () => {
      prisma.user.findUnique.mockResolvedValue({ onboarded: false });
      const boom = new Error('db down');
      prisma.user.update.mockRejectedValue(boom);

      await expect(service.completeOnboarding('user-1', dto)).rejects.toBe(
        boom,
      );
    });
  });

  describe('isUsernameAvailable', () => {
    it('is true when no user has claimed that handle', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.isUsernameAvailable('Mado-123')).resolves.toBe(true);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'Mado-123' },
        select: { id: true },
      });
    });

    it('is false when the handle is already claimed', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'someone-else' });

      await expect(service.isUsernameAvailable('Mado-123')).resolves.toBe(
        false,
      );
    });
  });

  describe('searchForPicker', () => {
    const a = { id: 'u1', name: 'Mado', image: null };
    const b = { id: 'u2', name: 'Amado', image: 'x' };

    it('rate limits per caller before querying', async () => {
      limiter.assertNotRateLimited.mockImplementation(() => {
        throw new Error('limited');
      });

      await expect(
        service.searchForPicker('me', { q: 'ma', limit: 8 }),
      ).rejects.toThrow('limited');
      expect(limiter.assertNotRateLimited).toHaveBeenCalledWith('me');
      expect(repository.searchByName).not.toHaveBeenCalled();
    });

    it('returns prefix matches first, then contains for the remaining slots', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.searchByName
        .mockResolvedValueOnce([a])
        .mockResolvedValueOnce([b]);

      const result = await service.searchForPicker('me', { q: 'ma', limit: 3 });

      expect(result).toEqual({ items: [a, b] });
      expect(repository.searchByName).toHaveBeenNthCalledWith(
        1,
        'me',
        'ma',
        'prefix',
        3,
      );
      expect(repository.searchByName).toHaveBeenNthCalledWith(
        2,
        'me',
        'ma',
        'contains',
        2,
      );
    });

    it('puts an exact id match first and does not repeat it', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.findPickableById.mockResolvedValueOnce(b);
      repository.searchByName
        .mockResolvedValueOnce([a, b])
        .mockResolvedValueOnce([]);

      const result = await service.searchForPicker('me', { q: b.id, limit: 3 });

      expect(repository.findPickableById).toHaveBeenCalledWith('me', b.id);
      expect(result).toEqual({ items: [b, a] });
    });

    it('skips the contains query when prefix matches fill the limit', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.searchByName.mockResolvedValueOnce([a]);

      await service.searchForPicker('me', { q: 'ma', limit: 1 });

      expect(repository.searchByName).toHaveBeenCalledTimes(1);
    });
  });
});
