import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { GameModeratorsRepository } from './game-moderators.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('./game-moderators.repository', () => ({
  GameModeratorsRepository: class {},
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { GameModeratorsService } from './game-moderators.service';

describe('GameModeratorsService', () => {
  const gameModeratorsRepository = {
    findUserById: jest.fn(),
    findByGameIdAndUserId: jest.fn(),
    findGameBySlug: jest.fn(),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  let service: GameModeratorsService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new GameModeratorsService(
      gameModeratorsRepository as unknown as GameModeratorsRepository,
      prisma as unknown as PrismaService,
    );
  });

  describe('assertCanModerateGame', () => {
    it('allows an admin without checking moderator assignment', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
      });

      await expect(
        service.assertCanModerateGame('game-1', 'admin-1'),
      ).resolves.toBeUndefined();

      expect(
        gameModeratorsRepository.findByGameIdAndUserId,
      ).not.toHaveBeenCalled();
    });

    it('allows an assigned moderator of the game', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'USER',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue({
        id: 'assignment-1',
      });

      await expect(
        service.assertCanModerateGame('game-1', 'mod-1'),
      ).resolves.toBeUndefined();
    });

    it('rejects a regular user who is not a moderator of the game', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'USER',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);

      await expect(
        service.assertCanModerateGame('game-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the moderator is assigned to a different game', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'USER',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);

      await expect(
        service.assertCanModerateGame('other-game', 'mod-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(
        gameModeratorsRepository.findByGameIdAndUserId,
      ).toHaveBeenCalledWith('other-game', 'mod-1');
    });

    it('rejects a banned admin before checking role', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        status: 'BANNED',
      });

      await expect(
        service.assertCanModerateGame('game-1', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(
        gameModeratorsRepository.findByGameIdAndUserId,
      ).not.toHaveBeenCalled();
    });

    it('rejects a suspended moderator even with a valid assignment', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'USER',
        status: 'SUSPENDED',
      });

      await expect(
        service.assertCanModerateGame('game-1', 'mod-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(
        gameModeratorsRepository.findByGameIdAndUserId,
      ).not.toHaveBeenCalled();
    });

    it('rejects with Unauthorized (not Forbidden) when the user no longer exists - matches AdminGuard/loadActiveUser', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.assertCanModerateGame('game-1', 'deleted-user'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resolveGameId', () => {
    it('returns the id of the game matching the slug', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
        name: 'Wuthering Waves',
        slug: 'wuthering-waves',
      });

      await expect(service.resolveGameId('wuthering-waves')).resolves.toBe(
        'game-1',
      );
    });

    it('throws when no game matches the slug', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue(null);

      await expect(service.resolveGameId('missing-game')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
