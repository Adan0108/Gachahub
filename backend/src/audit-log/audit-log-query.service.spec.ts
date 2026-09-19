import { ForbiddenException } from '@nestjs/common';

import type { AuditLogRepository } from './audit-log.repository';
import type { GameModeratorsService } from '../game-moderators/game-moderators.service';

jest.mock('./audit-log.repository', () => ({
  AuditLogRepository: class {},
}));

jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));

import { AuditLogQueryService } from './audit-log-query.service';

describe('AuditLogQueryService', () => {
  const auditLogRepository = { findMany: jest.fn() };
  const gameModeratorsService = {
    resolveGameId: jest.fn(),
    resolveModeratableGameId: jest.fn(),
  };

  let service: AuditLogQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    gameModeratorsService.resolveGameId.mockResolvedValue('game-1');
    gameModeratorsService.resolveModeratableGameId.mockResolvedValue('game-1');
    auditLogRepository.findMany.mockResolvedValue({ items: [], total: 0 });

    service = new AuditLogQueryService(
      auditLogRepository as unknown as AuditLogRepository,
      gameModeratorsService as unknown as GameModeratorsService,
    );
  });

  describe('listForModerator', () => {
    it('authorizes the routed game, then lists only that game with the filters', async () => {
      await service.listForModerator('wuthering-waves', 'mod-1', {
        action: 'POST_HIDDEN',
        actorId: 'mod-2',
        page: 2,
        limit: 10,
      });

      expect(
        gameModeratorsService.resolveModeratableGameId,
      ).toHaveBeenCalledWith('wuthering-waves', 'mod-1');
      expect(auditLogRepository.findMany).toHaveBeenCalledWith({
        gameId: 'game-1',
        action: 'POST_HIDDEN',
        actorId: 'mod-2',
        targetType: undefined,
        targetId: undefined,
        page: 2,
        limit: 10,
      });
    });

    it('propagates a permission failure without querying', async () => {
      gameModeratorsService.resolveModeratableGameId.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.listForModerator('game-1', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(auditLogRepository.findMany).not.toHaveBeenCalled();
    });

    it('wraps results in the paginated envelope with defaults', async () => {
      auditLogRepository.findMany.mockResolvedValue({ items: [{}], total: 21 });

      const result = await service.listForModerator('game-1', 'mod-1', {});

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 21,
        totalPages: 2,
      });
    });
  });

  describe('listAllForAdmin', () => {
    it('lists across every game when no gameSlug is given', async () => {
      await service.listAllForAdmin({});

      expect(gameModeratorsService.resolveGameId).not.toHaveBeenCalled();
      expect(auditLogRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: undefined }),
      );
    });

    it('resolves gameSlug into a gameId filter', async () => {
      await service.listAllForAdmin({ gameSlug: 'wuthering-waves' });

      expect(gameModeratorsService.resolveGameId).toHaveBeenCalledWith(
        'wuthering-waves',
      );
      expect(auditLogRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 'game-1' }),
      );
    });
  });
});
