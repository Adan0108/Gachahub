import { encodeCaseCursor } from '../domain/case-cursor';
import { encodeEvidenceCursor } from '../domain/report-evidence-pagination';
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
    findModerationCases: jest.fn(),
    findModerationCaseById: jest.fn(),
    findReportsByCaseId: jest.fn(),
    findCaseTarget: jest.fn(),
    findCaseReasonSummaries: jest.fn(),
    claimCase: jest.fn(),
    finalizeCase: jest.fn(),
  };

  const gameModeratorsService = {
    resolveGameId: jest.fn(),
    resolveModeratableGameId: jest.fn(),
  };

  const prisma = { user: { findUnique: jest.fn() } };
  const auditLogService = { recordOrThrow: jest.fn() };
  const tx = {} as Prisma.TransactionClient;

  let service: ReportModerationService;

  beforeEach(() => {
    jest.resetAllMocks();
    reportsRepository.findCaseReasonSummaries.mockResolvedValue(new Map());
    gameModeratorsService.resolveGameId.mockResolvedValue('game-1');
    gameModeratorsService.resolveModeratableGameId.mockResolvedValue('game-1');

    service = new ReportModerationService(
      reportsRepository as unknown as ReportsRepository,
      gameModeratorsService as unknown as GameModeratorsService,
      auditLogService as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('native case reads', () => {
    const moderationCase = {
      id: 'case',
      targetType: 'POST',
      targetId: 'post',
      gameId: null,
      status: 'OPEN',
      reportCount: 9,
      uniqueReporterCount: 8,
      resolutionNote: 'note',
    };
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'PLATFORM_MODERATOR',
        status: 'ACTIVE',
      });
      reportsRepository.findModerationCases.mockResolvedValue({
        items: [moderationCase],
        nextCursor: null,
      });
      reportsRepository.findModerationCaseById.mockResolvedValue(
        moderationCase,
      );
      reportsRepository.findCaseTarget.mockResolvedValue({
        target: null,
        targetState: 'missing',
      });
      reportsRepository.findReportsByCaseId.mockResolvedValue({
        items: [],
        nextCursor: null,
      });
    });
    it.each(['ADMIN', 'PLATFORM_MODERATOR'])(
      'allows live %s for every read and preserves native status/stored counters',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue({ role, status: 'ACTIVE' });
        expect(
          (await service.listCasesForPlatform('actor', {})).items[0].status,
        ).toBe('OPEN');
        expect(await service.getCaseForPlatform('actor', 'case')).toMatchObject(
          {
            reportCount: 9,
            uniqueReporterCount: 8,
            target: null,
            targetState: 'missing',
            evidence: { items: [] },
          },
        );
        expect(
          await service.listCaseReportsForPlatform('actor', 'case', {}),
        ).toEqual({ items: [], nextCursor: null });
        expect(reportsRepository.findReportsByCaseId).toHaveBeenCalledWith(
          'case',
          20,
        );
        expect(prisma.user.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'actor' } }),
        );
      },
    );
    it('returns only the cursor envelope and rejects invalid boundaries before repository access', async () => {
      reportsRepository.findModerationCases.mockResolvedValue({
        items: [moderationCase],
        nextCursor: 'next',
      });
      const cursor = {
        id: 'case-boundary',
        createdAt: new Date('2026-10-20T00:00:00.000Z'),
      };
      expect(
        await service.listCasesForPlatform('actor', {
          cursor: encodeCaseCursor({
            id: cursor.id,
            lastReportedAt: cursor.createdAt,
          }),
        }),
      ).toEqual({ items: [moderationCase], nextCursor: 'next' });
      expect(reportsRepository.findModerationCases).toHaveBeenCalledWith({
        gameId: undefined,
        status: undefined,
        targetType: undefined,
        limit: 20,
        cursor: { id: cursor.id, lastReportedAt: cursor.createdAt },
      });
      await expect(
        service.listCasesForPlatform('actor', { cursor: 'bad' }),
      ).rejects.toThrow('Invalid case cursor');
      await expect(
        service.listCasesForGame('slug', 'actor', { cursor: 'bad' }),
      ).rejects.toThrow('Invalid case cursor');
      expect(reportsRepository.findModerationCases).toHaveBeenCalledTimes(1);
    });
    it.each([
      { role: 'USER', status: 'ACTIVE' }, // Assignment cannot elevate this platform capability.
      { role: 'ADMIN', status: 'SUSPENDED' },
      { role: 'PLATFORM_MODERATOR', status: 'SUSPENDED' },
    ])('denies every read before any sensitive lookup: %j', async (user) => {
      prisma.user.findUnique.mockResolvedValue(user);
      for (const read of [
        () =>
          service.listCasesForPlatform('actor', {
            scope: 'game',
            gameSlug: 'slug',
          }),
        () => service.getCaseForPlatform('actor', 'case'),
        () => service.listCaseReportsForPlatform('actor', 'case', {}),
      ]) {
        await expect(read()).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(gameModeratorsService.resolveGameId).not.toHaveBeenCalled();
      for (const method of [
        reportsRepository.findModerationCases,
        reportsRepository.findModerationCaseById,
        reportsRepository.findCaseTarget,
        reportsRepository.findReportsByCaseId,
      ])
        expect(method).not.toHaveBeenCalled();
    });
    it.each([
      ['all', undefined],
      ['platform', null],
      ['game', 'game-1'],
    ] as const)(
      'maps native %s filters without legacy conversion',
      async (scope, gameId) => {
        await service.listCasesForPlatform('actor', {
          scope,
          ...(scope === 'game' ? { gameSlug: 'slug' } : {}),
          status: 'OPEN',
          targetType: 'POST',
          limit: 10,
        });
        expect(reportsRepository.findModerationCases).toHaveBeenCalledWith({
          gameId,
          cursor: undefined,
          status: 'OPEN',
          targetType: 'POST',
          limit: 10,
        });
        expect(
          gameModeratorsService.resolveModeratableGameId,
        ).not.toHaveBeenCalled();
      },
    );
    it.each([
      { scope: 'game' as const },
      { scope: 'game' as const, gameSlug: '  ' },
      { scope: 'platform' as const, gameSlug: 'x' },
      { scope: 'all' as const, gameSlug: 'x' },
    ])('rejects invalid scope combinations %j', async (query) => {
      await expect(
        service.listCasesForPlatform('actor', query),
      ).rejects.toThrow('gameSlug is required only');
      expect(reportsRepository.findModerationCases).not.toHaveBeenCalled();
    });
    it('preserves unknown game 404', async () => {
      gameModeratorsService.resolveGameId.mockRejectedValue(
        new NotFoundException(),
      );
      await expect(
        service.listCasesForPlatform('actor', {
          scope: 'game',
          gameSlug: 'missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
    it('returns 404 for missing cases without looking up targets or evidence', async () => {
      reportsRepository.findModerationCaseById.mockResolvedValue(null);
      await expect(
        service.getCaseForPlatform('actor', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.listCaseReportsForPlatform('actor', 'missing', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reportsRepository.findCaseTarget).not.toHaveBeenCalled();
      expect(reportsRepository.findReportsByCaseId).not.toHaveBeenCalled();
    });
    it('passes parsed exclusive evidence boundaries and bounded limit', async () => {
      const cursor = {
        id: 'report',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      await service.listCaseReportsForPlatform('actor', 'case', {
        cursor: encodeEvidenceCursor(cursor),
        limit: 5,
      });
      expect(reportsRepository.findReportsByCaseId).toHaveBeenCalledWith(
        'case',
        5,
        cursor,
      );
    });
    it('rejects malformed cursor without evidence access', async () => {
      await expect(
        service.listCaseReportsForPlatform('actor', 'case', { cursor: 'bad!' }),
      ).rejects.toThrow('Invalid evidence cursor');
      expect(reportsRepository.findReportsByCaseId).not.toHaveBeenCalled();
    });
  });

  describe('native game authorization and shared mutations', () => {
    const moderationCase = {
      id: 'case',
      gameId: 'game-1',
      game: { slug: 'slug' },
      targetType: 'POST',
      targetId: 'post',
      status: 'OPEN',
      reportCount: 3,
      resolutionNote: null,
    };
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'PLATFORM_MODERATOR',
        status: 'ACTIVE',
      });
      reportsRepository.findModerationCaseById.mockResolvedValue(
        moderationCase,
      );
      reportsRepository.findModerationCases.mockResolvedValue({
        items: [moderationCase],
        nextCursor: null,
      });
      reportsRepository.findCaseTarget.mockResolvedValue({
        target: null,
        targetState: 'missing',
      });
      reportsRepository.findReportsByCaseId.mockResolvedValue({
        items: [],
        nextCursor: null,
      });
      reportsRepository.claimCase.mockResolvedValue({
        ...moderationCase,
        status: 'IN_REVIEW',
      });
      reportsRepository.finalizeCase.mockResolvedValue({
        ...moderationCase,
        status: 'RESOLVED',
      });
    });
    it('scopes game list/detail/evidence to authorized exact game', async () => {
      await service.listCasesForGame('slug', 'actor', { status: 'OPEN' });
      expect(reportsRepository.findModerationCases).toHaveBeenCalledWith({
        gameId: 'game-1',
        cursor: undefined,
        status: 'OPEN',
        targetType: undefined,
        limit: 20,
      });
      await service.getCaseForGame('slug', 'actor', 'case');
      await service.listCaseReportsForGame('slug', 'actor', 'case', {
        limit: 2,
      });
      expect(
        gameModeratorsService.resolveModeratableGameId,
      ).toHaveBeenCalledWith('slug', 'actor');
      expect(reportsRepository.findReportsByCaseId).toHaveBeenLastCalledWith(
        'case',
        2,
        undefined,
      );
    });
    it.each([null, 'other'])(
      'hides inaccessible gameId %s for all game actions/reads',
      async (gameId) => {
        reportsRepository.findModerationCaseById.mockResolvedValue({
          ...moderationCase,
          gameId,
        });
        for (const read of [
          () => service.getCaseForGame('slug', 'actor', 'case'),
          () => service.listCaseReportsForGame('slug', 'actor', 'case', {}),
          () => service.claimCaseForGame('slug', 'actor', 'case'),
          () => service.resolveCaseForGame('slug', 'actor', 'case', {}),
          () => service.dismissCaseForGame('slug', 'actor', 'case', {}),
        ])
          await expect(read()).rejects.toBeInstanceOf(NotFoundException);
        expect(reportsRepository.findCaseTarget).not.toHaveBeenCalled();
        expect(reportsRepository.claimCase).not.toHaveBeenCalled();
        expect(reportsRepository.finalizeCase).not.toHaveBeenCalled();
      },
    );
    it('rejects unauthorized game actors before case lookup', async () => {
      gameModeratorsService.resolveModeratableGameId.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        service.claimCaseForGame('slug', 'actor', 'case'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getCaseForGame('slug', 'actor', 'case'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(reportsRepository.findModerationCaseById).not.toHaveBeenCalled();
    });
    it.each(['ADMIN', 'PLATFORM_MODERATOR'])(
      'allows live %s platform mutations including personal cases',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue({ role, status: 'ACTIVE' });
        reportsRepository.findModerationCaseById.mockResolvedValue({
          ...moderationCase,
          gameId: null,
        });
        await service.claimCaseForPlatform('actor', 'case');
        await service.resolveCaseForPlatform('actor', 'case', {
          resolutionNote: '  Reviewed  ',
        });
        await service.dismissCaseForPlatform('actor', 'case', {});
        expect(reportsRepository.claimCase).toHaveBeenCalledWith(
          'case',
          'actor',
          expect.objectContaining({ gameId: undefined }),
        );
        expect(reportsRepository.finalizeCase).toHaveBeenCalledWith(
          {
            id: 'case',
            status: 'RESOLVED',
            resolvedById: 'actor',
            resolutionNote: 'Reviewed',
          },
          expect.anything(),
        );
      },
    );
    it.each([
      { role: 'USER', status: 'ACTIVE' },
      { role: 'ADMIN', status: 'SUSPENDED' },
      { role: 'PLATFORM_MODERATOR', status: 'BANNED' },
    ])(
      'denies platform mutations before existence checks: %j',
      async (user) => {
        prisma.user.findUnique.mockResolvedValue(user);
        for (const action of [
          () => service.claimCaseForPlatform('actor', 'missing'),
          () => service.resolveCaseForPlatform('actor', 'missing', {}),
          () => service.dismissCaseForPlatform('actor', 'missing', {}),
        ])
          await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
        expect(reportsRepository.findModerationCaseById).not.toHaveBeenCalled();
      },
    );
    it('uses one case-target audit callback for both scopes, within the repository transaction', async () => {
      await service.claimCaseForGame('slug', 'actor', 'case');
      const [, , context] = reportsRepository.claimCase.mock
        .calls[0] as unknown as [
        string,
        string,
        import('../reports.repository').CaseTransitionContext,
      ];
      expect(context.gameId).toBe('game-1');
      await context.audit(
        { ...moderationCase, status: 'IN_REVIEW' } as unknown as Parameters<
          typeof context.audit
        >[0],
        tx,
      );
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        {
          action: 'CASE_CLAIMED',
          actorId: 'actor',
          targetType: 'MODERATION_CASE',
          targetId: 'case',
          gameId: 'game-1',
          gameSlug: 'slug',
          metadata: {
            caseId: 'case',
            targetType: 'POST',
            targetId: 'post',
            gameId: 'game-1',
            reportCount: 3,
          },
        },
        tx,
      );
    });
    it('maps failed conditional writes to 409 and missing IDs to 404', async () => {
      reportsRepository.claimCase.mockResolvedValue(null);
      reportsRepository.finalizeCase.mockResolvedValue(null);
      await expect(
        service.claimCaseForPlatform('actor', 'case'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.resolveCaseForPlatform('actor', 'case', {}),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.dismissCaseForGame('slug', 'actor', 'case', {}),
      ).rejects.toBeInstanceOf(ConflictException);
      reportsRepository.findModerationCaseById.mockResolvedValue(null);
      await expect(
        service.claimCaseForPlatform('actor', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
