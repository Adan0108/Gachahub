import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
  };

  const blocksService = {
    isBlocked: jest.fn(),
  };

  const repository = {
    searchByName: jest.fn(),
    findPickableById: jest.fn(),
    findPickableByUsername: jest.fn(),
  };
  const limiter = { assertNotRateLimited: jest.fn() };
  const usernameLimiter = { assertNotRateLimited: jest.fn() };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as any,
      blocksService as any,
      repository as any,
      limiter as any,
      usernameLimiter as any,
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
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
    });
  });

  describe('completeOnboarding', () => {
    const dto = { name: 'Mado', username: 'Mado-123' };
    const claimedRow = { id: 'user-1', ...dto, onboarded: true };

    it('throws when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('refuses a reserved handle without touching the database write', async () => {
      await expect(
        service.completeOnboarding('user-1', { ...dto, username: 'admin' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('refuses a reserved handle case-insensitively', async () => {
      await expect(
        service.completeOnboarding('user-1', { ...dto, username: 'Admin' }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a second claim once a username is already set', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: 'existing' });

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('claims atomically, conditioned on username still being null, and returns the row', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: null });
      prisma.user.updateManyAndReturn.mockResolvedValue([claimedRow]);

      await expect(service.completeOnboarding('user-1', dto)).resolves.toBe(
        claimedRow,
      );

      expect(prisma.user.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', username: null },
          data: { name: dto.name, username: dto.username, onboarded: true },
        }),
      );
    });

    it('two parallel claims for one account: exactly one succeeds, the other gets a 409', async () => {
      // Both pre-reads see username: null (the TOCTOU window); the database lets only the
      // first conditional update match the row.
      prisma.user.findUnique.mockResolvedValue({ username: null });
      prisma.user.updateManyAndReturn
        .mockResolvedValueOnce([claimedRow])
        .mockResolvedValueOnce([]);

      const results = await Promise.allSettled([
        service.completeOnboarding('user-1', dto),
        service.completeOnboarding('user-1', { ...dto, username: 'Other-1' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    });

    it('maps a taken handle (P2002) to a 409 instead of leaking the Prisma error', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: null });
      prisma.user.updateManyAndReturn.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['username'] },
        }),
      );

      await expect(service.completeOnboarding('user-1', dto)).rejects.toThrow(
        'That handle is taken',
      );
    });

    it('does not swallow an unrelated error', async () => {
      prisma.user.findUnique.mockResolvedValue({ username: null });
      const boom = new Error('db down');
      prisma.user.updateManyAndReturn.mockRejectedValue(boom);

      await expect(service.completeOnboarding('user-1', dto)).rejects.toBe(
        boom,
      );
    });
  });

  describe('isUsernameAvailable', () => {
    it('rate limits per caller before querying', async () => {
      usernameLimiter.assertNotRateLimited.mockImplementation(() => {
        throw new Error('limited');
      });

      await expect(
        service.isUsernameAvailable('me', 'Mado-123'),
      ).rejects.toThrow('limited');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('is true when no user has claimed that handle', async () => {
      usernameLimiter.assertNotRateLimited.mockReset();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.isUsernameAvailable('me', 'Mado-123')).resolves.toBe(
        true,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'Mado-123' },
        select: { id: true },
      });
    });

    it('is false when the handle is already claimed', async () => {
      usernameLimiter.assertNotRateLimited.mockReset();
      prisma.user.findUnique.mockResolvedValue({ id: 'someone-else' });

      await expect(service.isUsernameAvailable('me', 'Mado-123')).resolves.toBe(
        false,
      );
    });

    it('is false for a reserved handle without hitting the database', async () => {
      usernameLimiter.assertNotRateLimited.mockReset();

      await expect(service.isUsernameAvailable('me', 'admin')).resolves.toBe(
        false,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
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

    it('looks up an @query as an exact handle, with no name or id search', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.findPickableByUsername.mockResolvedValueOnce(a);

      const result = await service.searchForPicker('me', {
        q: '@mado',
        limit: 3,
      });

      expect(result).toEqual({ items: [a] });
      expect(repository.findPickableByUsername).toHaveBeenCalledWith(
        'me',
        'mado',
      );
      expect(repository.findPickableById).not.toHaveBeenCalled();
      expect(repository.searchByName).not.toHaveBeenCalled();
    });

    it('returns nothing for an @query that matches no handle', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.findPickableByUsername.mockResolvedValueOnce(null);

      const result = await service.searchForPicker('me', {
        q: '@ghost',
        limit: 3,
      });

      expect(result).toEqual({ items: [] });
      expect(repository.searchByName).not.toHaveBeenCalled();
    });

    it('skips the contains query when prefix matches fill the limit', async () => {
      limiter.assertNotRateLimited.mockReset();
      repository.searchByName.mockResolvedValueOnce([a]);

      await service.searchForPicker('me', { q: 'ma', limit: 1 });

      expect(repository.searchByName).toHaveBeenCalledTimes(1);
    });
  });
});
