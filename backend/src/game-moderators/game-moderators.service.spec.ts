import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { GameModeratorsRepository } from './game-moderators.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

jest.mock('./game-moderators.repository', () => ({
  GameModeratorsRepository: class {},
}));

jest.mock('../audit-log/audit-log.service', () => ({
  AuditLogService: class {},
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
    findUserByEmail: jest.fn(),
    create: jest.fn(),
    deleteByGameIdAndUserId: jest.fn(),
  };

  const auditLogService = { record: jest.fn(), recordOrThrow: jest.fn() };

  const tx = { tx: true };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: GameModeratorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditLogService.recordOrThrow.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );

    service = new GameModeratorsService(
      gameModeratorsRepository as unknown as GameModeratorsRepository,
      prisma as unknown as PrismaService,
      auditLogService as unknown as AuditLogService,
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

  describe('resolveModeratableGameId', () => {
    beforeEach(() => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('returns the game id for a moderator of that game', async () => {
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue({
        id: 'assignment-1',
      });

      await expect(
        service.resolveModeratableGameId('wuthering-waves', 'mod-1'),
      ).resolves.toBe('game-1');
    });

    it('rejects a non-moderator', async () => {
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);

      await expect(
        service.resolveModeratableGameId('wuthering-waves', 'mod-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an unknown game before checking permission', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue(null);

      await expect(
        service.resolveModeratableGameId('missing', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('loadModeratableResource', () => {
    const load = jest.fn();

    const callHelper = () =>
      service.loadModeratableResource({
        gameSlug: 'wuthering-waves',
        moderatorId: 'mod-1',
        notFoundMessage: 'Thing not found',
        load,
      });

    beforeEach(() => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'USER',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue({
        id: 'assignment-1',
      });
    });

    it('returns the resource and its game when it belongs to the routed game', async () => {
      load.mockResolvedValue({ id: 'thing-1', gameId: 'game-1' });

      await expect(callHelper()).resolves.toEqual({
        gameId: 'game-1',
        resource: { id: 'thing-1', gameId: 'game-1' },
      });
    });

    it('authorizes the caller BEFORE loading the resource, so existence is never leaked to non-moderators', async () => {
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);

      await expect(callHelper()).rejects.toThrow(ForbiddenException);

      expect(load).not.toHaveBeenCalled();
    });

    it('rejects a resource that does not exist', async () => {
      load.mockResolvedValue(null);

      await expect(callHelper()).rejects.toThrow('Thing not found');
    });

    it('rejects a resource that belongs to a different game than the route', async () => {
      load.mockResolvedValue({ id: 'thing-1', gameId: 'other-game' });

      await expect(callHelper()).rejects.toThrow(NotFoundException);
    });

    it('lets an admin through without a moderator assignment', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'mod-1',
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      load.mockResolvedValue({ id: 'thing-1', gameId: 'game-1' });

      await expect(callHelper()).resolves.toBeDefined();

      expect(
        gameModeratorsRepository.findByGameIdAndUserId,
      ).not.toHaveBeenCalled();
    });
  });

  describe('assignModerator', () => {
    it('creates the assignment and audits it', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
        slug: 'wuthering-waves',
      });
      gameModeratorsRepository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);
      gameModeratorsRepository.create.mockResolvedValue({ id: 'assignment-1' });

      await expect(
        service.assignModerator(
          'wuthering-waves',
          { userId: 'user-2' },
          'admin-1',
        ),
      ).resolves.toEqual({ id: 'assignment-1' });

      expect(gameModeratorsRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        tx,
      );
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        {
          action: 'MODERATOR_ASSIGNED',
          actorId: 'admin-1',
          targetType: 'USER',
          targetId: 'user-2',
          gameId: 'game-1',
          gameSlug: 'wuthering-waves',
        },
        tx,
      );
    });

    it('fails the assignment when its audit entry cannot be written', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
      });
      gameModeratorsRepository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      gameModeratorsRepository.findByGameIdAndUserId.mockResolvedValue(null);
      gameModeratorsRepository.create.mockResolvedValue({ id: 'assignment-1' });
      auditLogService.recordOrThrow.mockRejectedValue(new Error('db down'));

      await expect(
        service.assignModerator(
          'wuthering-waves',
          { userId: 'user-2' },
          'admin-1',
        ),
      ).rejects.toThrow('db down');
    });

    it('does not audit a rejected assignment', async () => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
      });
      gameModeratorsRepository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'BANNED',
      });

      await expect(
        service.assignModerator(
          'wuthering-waves',
          { userId: 'user-2' },
          'admin-1',
        ),
      ).rejects.toThrow();

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('removeModerator', () => {
    beforeEach(() => {
      gameModeratorsRepository.findGameBySlug.mockResolvedValue({
        id: 'game-1',
        slug: 'wuthering-waves',
      });
    });

    it('deletes the assignment and audits it in one transaction', async () => {
      gameModeratorsRepository.deleteByGameIdAndUserId.mockResolvedValue({
        count: 1,
      });

      await service.removeModerator('wuthering-waves', 'user-2', 'admin-1');

      expect(
        gameModeratorsRepository.deleteByGameIdAndUserId,
      ).toHaveBeenCalledWith('game-1', 'user-2', tx);
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        {
          action: 'MODERATOR_REMOVED',
          actorId: 'admin-1',
          targetType: 'USER',
          targetId: 'user-2',
          gameId: 'game-1',
          gameSlug: 'wuthering-waves',
        },
        tx,
      );
    });

    it('answers 404, not a 500, when a concurrent removal already deleted the assignment', async () => {
      gameModeratorsRepository.deleteByGameIdAndUserId.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.removeModerator('wuthering-waves', 'user-2', 'admin-1'),
      ).rejects.toThrow(NotFoundException);

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
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
