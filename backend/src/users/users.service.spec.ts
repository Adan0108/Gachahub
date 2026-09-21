import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const blocksService = {
    isBlocked: jest.fn(),
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma as any, blocksService as any);
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
});
