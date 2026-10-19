import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { ReportsRepository } from '../reports.repository';
import type { GameModeratorsService } from '../../game-moderators/game-moderators.service';
import type { AuditLogService } from '../../audit-log/audit-log.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

jest.mock('../reports.repository', () => ({
  ReportsRepository: class {},
}));

jest.mock('../../audit-log/audit-log.service', () => ({
  AuditLogService: class {},
}));

jest.mock('../../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));

import { ReportModerationService } from './report-moderation.service';

describe('ReportModerationService', () => {
  const reportsRepository = {
    findById: jest.fn(),
    findMany: jest.fn(),
    claim: jest.fn<Promise<unknown>, Parameters<ReportsRepository['claim']>>(),
    finalize: jest.fn<
      Promise<unknown>,
      Parameters<ReportsRepository['finalize']>
    >(),
  };

  const gameModeratorsService = {
    resolveGameId: jest.fn(),
    resolveModeratableGameId: jest.fn(),
    loadModeratableResource: jest.fn(),
  };

  const prisma = { user: { findUnique: jest.fn() } };
  const auditLogService = { recordOrThrow: jest.fn() };
  const tx = {} as Prisma.TransactionClient;

  let service: ReportModerationService;

  const baseReport = {
    id: 'report-1',
    caseId: 'case-1',
    gameId: 'game-1',
    reporterId: 'reporter-1',
    targetType: 'POST',
    targetId: 'post-1',
    reasonCode: 'HARASSMENT',
    status: 'PENDING',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    gameModeratorsService.resolveGameId.mockResolvedValue('game-1');
    gameModeratorsService.resolveModeratableGameId.mockResolvedValue('game-1');
    // A faithful fake of GameModeratorsService.loadModeratableResource's
    // contract (load -> null or wrong game => NotFound). The real method's
    // own behavior, including authorize-before-load ordering, is covered in
    // game-moderators.service.spec.ts.
    gameModeratorsService.loadModeratableResource.mockImplementation(
      async (params: {
        notFoundMessage: string;
        load: () => Promise<{ gameId: string } | null>;
      }) => {
        const resource = await params.load();

        if (!resource || resource.gameId !== 'game-1') {
          throw new NotFoundException(params.notFoundMessage);
        }

        return { gameId: 'game-1', resource };
      },
    );

    service = new ReportModerationService(
      reportsRepository as unknown as ReportsRepository,
      gameModeratorsService as unknown as GameModeratorsService,
      auditLogService as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('listForPlatform', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'PLATFORM_MODERATOR',
        status: 'ACTIVE',
      });
      reportsRepository.findMany.mockResolvedValue({
        items: [baseReport],
        total: 1,
      });
    });
    it.each(['ADMIN', 'PLATFORM_MODERATOR'])(
      'allows live %s role and preserves report pagination',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue({ role, status: 'ACTIVE' });
        const result = await service.listForPlatform('actor', {
          page: 2,
          limit: 3,
          status: 'PENDING',
          targetType: 'POST',
        });
        expect(prisma.user.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'actor' } }),
        );
        expect(reportsRepository.findMany).toHaveBeenCalledWith({
          gameId: undefined,
          page: 2,
          limit: 3,
          status: 'PENDING',
          targetType: 'POST',
        });
        expect(result.items).toEqual([baseReport]);
        expect(result.meta.total).toBe(1);
      },
    );
    it.each([
      ['all', undefined],
      ['platform', null],
      ['game', 'game-1'],
    ] as const)('maps %s scope', async (scope, gameId) => {
      await service.listForPlatform('actor', {
        scope,
        ...(scope === 'game' ? { gameSlug: 'slug' } : {}),
      });
      expect(reportsRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ gameId }),
      );
      if (scope === 'game')
        expect(gameModeratorsService.resolveGameId).toHaveBeenCalledWith(
          'slug',
        );
      else expect(gameModeratorsService.resolveGameId).not.toHaveBeenCalled();
    });
    it.each([
      { scope: 'game' as const },
      { scope: 'game' as const, gameSlug: '' },
      { scope: 'platform' as const, gameSlug: 'slug' },
      { scope: 'all' as const, gameSlug: 'slug' },
    ])('rejects contradictory or missing slug: %j', async (query) => {
      await expect(service.listForPlatform('actor', query)).rejects.toThrow(
        'gameSlug is required only',
      );
      expect(reportsRepository.findMany).not.toHaveBeenCalled();
    });
    it('preserves unknown game 404', async () => {
      gameModeratorsService.resolveGameId.mockRejectedValue(
        new NotFoundException(),
      );
      await expect(
        service.listForPlatform('actor', {
          scope: 'game',
          gameSlug: 'missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
    it.each([
      { role: 'USER', status: 'ACTIVE' },
      { role: 'PLATFORM_MODERATOR', status: 'BANNED' },
    ])(
      'denies unauthorized users before any lookup, including assigned game moderators: %j',
      async (user) => {
        prisma.user.findUnique.mockResolvedValue(user);
        await expect(
          service.listForPlatform('actor', { scope: 'game', gameSlug: 'slug' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(gameModeratorsService.resolveGameId).not.toHaveBeenCalled();
        expect(reportsRepository.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('listForModerator', () => {
    it('resolves and authorizes the routed game, then lists that game only', async () => {
      reportsRepository.findMany.mockResolvedValue({
        items: [baseReport],
        total: 1,
      });

      const result = await service.listForModerator(
        'wuthering-waves',
        'mod-1',
        {},
      );

      expect(
        gameModeratorsService.resolveModeratableGameId,
      ).toHaveBeenCalledWith('wuthering-waves', 'mod-1');
      expect(reportsRepository.findMany).toHaveBeenCalledWith({
        gameId: 'game-1',
        status: undefined,
        targetType: undefined,
        page: 1,
        limit: 20,
      });
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('propagates the moderator permission check failure', async () => {
      gameModeratorsService.resolveModeratableGameId.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.listForModerator('game-1', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(reportsRepository.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listAllForAdmin', () => {
    it('lists across every game when no gameSlug filter is given', async () => {
      reportsRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await service.listAllForAdmin({});

      expect(gameModeratorsService.resolveGameId).not.toHaveBeenCalled();
      expect(reportsRepository.findMany).toHaveBeenCalledWith({
        gameId: undefined,
        status: undefined,
        targetType: undefined,
        page: 1,
        limit: 20,
      });
    });

    it('resolves gameSlug into a gameId filter when given', async () => {
      reportsRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await service.listAllForAdmin({ gameSlug: 'wuthering-waves' });

      expect(gameModeratorsService.resolveGameId).toHaveBeenCalledWith(
        'wuthering-waves',
      );
      expect(reportsRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 'game-1' }),
      );
    });
  });

  describe('claim', () => {
    it('runs the shared moderation preamble, then claims for the calling moderator', async () => {
      reportsRepository.findById.mockResolvedValue(baseReport);
      reportsRepository.claim.mockResolvedValue({
        ...baseReport,
        status: 'IN_REVIEW',
        assignedModeratorId: 'mod-1',
      });

      const result = await service.claim('game-1', 'report-1', 'mod-1');

      expect(
        gameModeratorsService.loadModeratableResource,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          gameSlug: 'game-1',
          moderatorId: 'mod-1',
          notFoundMessage: 'Report not found',
        }),
      );
      expect(reportsRepository.claim).toHaveBeenCalledWith(
        'report-1',
        'mod-1',
        expect.objectContaining({
          gameId: 'game-1',
        }),
      );
      expect(result.status).toBe('IN_REVIEW');
      await reportsRepository.claim.mock.calls[0][2].audit(result, tx);
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        {
          action: 'REPORT_CLAIMED',
          actorId: 'mod-1',
          targetType: 'REPORT',
          targetId: 'report-1',
          gameId: 'game-1',
          gameSlug: 'game-1',
          metadata: {
            reportId: 'report-1',
            caseId: 'case-1',
            reportedTargetType: 'POST',
            reportedTargetId: 'post-1',
          },
        },
        tx,
      );
    });

    it('answers 409 for a report that is not claimable - one code whether it was already claimed before this request or mid-request', async () => {
      reportsRepository.findById.mockResolvedValue({
        ...baseReport,
        status: 'IN_REVIEW',
      });
      reportsRepository.claim.mockResolvedValue(null);

      await expect(
        service.claim('game-1', 'report-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
    });

    it('rejects when the report belongs to a different game than the route', async () => {
      reportsRepository.findById.mockResolvedValue({
        ...baseReport,
        gameId: 'other-game-id',
      });

      await expect(
        service.claim('game-1', 'report-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(reportsRepository.claim).not.toHaveBeenCalled();
    });

    it('rejects a missing report', async () => {
      reportsRepository.findById.mockResolvedValue(null);

      await expect(
        service.claim('game-1', 'report-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates the moderator permission failure without loading the report or writing', async () => {
      gameModeratorsService.loadModeratableResource.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.claim('game-1', 'report-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(reportsRepository.findById).not.toHaveBeenCalled();
      expect(reportsRepository.claim).not.toHaveBeenCalled();
    });
  });

  describe('resolve / dismiss', () => {
    it('resolves an open report with a trimmed note', async () => {
      reportsRepository.findById.mockResolvedValue(baseReport);
      reportsRepository.finalize.mockResolvedValue({
        ...baseReport,
        status: 'RESOLVED',
      });

      const result = await service.resolve('game-1', 'report-1', 'mod-1', {
        resolutionNote: '  Hid the post  ',
      });

      expect(reportsRepository.finalize).toHaveBeenCalledWith(
        {
          id: 'report-1',
          status: 'RESOLVED',
          resolvedById: 'mod-1',
          resolutionNote: 'Hid the post',
        },
        expect.objectContaining({
          gameId: 'game-1',
        }),
      );
      expect(result.status).toBe('RESOLVED');
      await reportsRepository.finalize.mock.calls[0][1].audit(result, tx);
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REPORT_RESOLVED',
          targetId: 'report-1',
        }),
        tx,
      );
    });

    it('dismisses an open report and drops a whitespace-only note', async () => {
      reportsRepository.findById.mockResolvedValue(baseReport);
      reportsRepository.finalize.mockResolvedValue({
        ...baseReport,
        status: 'DISMISSED',
      });

      const result = await service.dismiss('game-1', 'report-1', 'mod-1', {
        resolutionNote: '   ',
      });

      expect(reportsRepository.finalize).toHaveBeenCalledWith(
        {
          id: 'report-1',
          status: 'DISMISSED',
          resolvedById: 'mod-1',
          resolutionNote: undefined,
        },
        expect.objectContaining({
          gameId: 'game-1',
        }),
      );
      await reportsRepository.finalize.mock.calls[0][1].audit(result, tx);
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REPORT_DISMISSED' }),
        tx,
      );
    });

    it('answers 409 for an already-closed report, from either action', async () => {
      reportsRepository.findById.mockResolvedValue({
        ...baseReport,
        status: 'RESOLVED',
      });
      reportsRepository.finalize.mockResolvedValue(null);

      await expect(
        service.resolve('game-1', 'report-1', 'mod-1', {}),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.dismiss('game-1', 'report-1', 'mod-1', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the report is missing, without writing', async () => {
      reportsRepository.findById.mockResolvedValue(null);

      await expect(
        service.resolve('game-1', 'report-1', 'mod-1', {}),
      ).rejects.toThrow(NotFoundException);

      expect(reportsRepository.finalize).not.toHaveBeenCalled();
    });

    it('does not require the caller to be the moderator who claimed it', async () => {
      reportsRepository.findById.mockResolvedValue({
        ...baseReport,
        status: 'IN_REVIEW',
        assignedModeratorId: 'other-mod',
      });
      reportsRepository.finalize.mockResolvedValue({
        ...baseReport,
        status: 'RESOLVED',
      });

      await expect(
        service.resolve('game-1', 'report-1', 'mod-1', {}),
      ).resolves.toEqual(expect.objectContaining({ status: 'RESOLVED' }));
    });
  });
});
