import type { UsersRepository } from '../users/users.repository';
import type { GamesRepository } from '../games/games.repository';
import type { ReportsRepository } from '../reports/reports.repository';
import type { GameModeratorsRepository } from '../game-moderators/game-moderators.repository';
import type { AuditLogQueryService } from '../audit-log/audit-log-query.service';

/*
 * Unit test only mocks dependencies. Do not load their real implementations
 * because they eventually import Prisma.
 */
jest.mock('../users/users.repository', () => ({
  UsersRepository: class {},
}));
jest.mock('../games/games.repository', () => ({
  GamesRepository: class {},
}));
jest.mock('../reports/reports.repository', () => ({
  ReportsRepository: class {},
}));
jest.mock('../game-moderators/game-moderators.repository', () => ({
  GameModeratorsRepository: class {},
}));
jest.mock('../audit-log/audit-log-query.service', () => ({
  AuditLogQueryService: class {},
}));

import { OverviewService } from './overview.service';

describe('OverviewService', () => {
  const usersRepository = {
    countActive: jest.fn(),
    findManyNamesByIds: jest.fn(),
  };
  const gamesRepository = {
    countActive: jest.fn(),
    findTopByMemberCount: jest.fn(),
  };
  const reportsRepository = {
    countOpen: jest.fn(),
    countOpenByGameIds: jest.fn(),
  };
  const gameModeratorsRepository = { count: jest.fn() };
  const auditLogQueryService = { listAllForAdmin: jest.fn() };

  let service: OverviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.countActive.mockResolvedValue(1200);
    usersRepository.findManyNamesByIds.mockResolvedValue([]);
    gamesRepository.countActive.mockResolvedValue(6);
    gamesRepository.findTopByMemberCount.mockResolvedValue([]);
    reportsRepository.countOpen.mockResolvedValue(9);
    reportsRepository.countOpenByGameIds.mockResolvedValue([]);
    gameModeratorsRepository.count.mockResolvedValue(14);
    auditLogQueryService.listAllForAdmin.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 8, total: 0, totalPages: 0 },
    });

    service = new OverviewService(
      usersRepository as unknown as UsersRepository,
      gamesRepository as unknown as GamesRepository,
      reportsRepository as unknown as ReportsRepository,
      gameModeratorsRepository as unknown as GameModeratorsRepository,
      auditLogQueryService as unknown as AuditLogQueryService,
    );
  });

  it('returns the four platform-wide counts as metrics', async () => {
    const result = await service.getOverview();

    expect(result.metrics).toEqual([
      { id: 'members', value: 1200 },
      { id: 'communities', value: 6 },
      { id: 'reports', value: 9 },
      { id: 'moderators', value: 14 },
    ]);
    expect(usersRepository.countActive).toHaveBeenCalled();
    expect(gamesRepository.countActive).toHaveBeenCalled();
  });

  it('merges the top games with their own open report count', async () => {
    gamesRepository.findTopByMemberCount.mockResolvedValue([
      { id: 'game-1', name: 'Genshin Impact', _count: { members: 500 } },
      { id: 'game-2', name: 'Wuthering Waves', _count: { members: 300 } },
    ]);
    reportsRepository.countOpenByGameIds.mockResolvedValue([
      { gameId: 'game-1', count: 4 },
    ]);

    const result = await service.getOverview();

    expect(reportsRepository.countOpenByGameIds).toHaveBeenCalledWith([
      'game-1',
      'game-2',
    ]);
    expect(result.communities).toEqual([
      { id: 'game-1', name: 'Genshin Impact', members: 500, reports: 4 },
      { id: 'game-2', name: 'Wuthering Waves', members: 300, reports: 0 },
    ]);
  });

  // Per-target-type subject/name resolution is exercised directly against
  // formatActivityEntries in overview-activity.mapper.spec.ts - these only
  // check that getOverview wires the audit log page and the user-name batch
  // lookup through to it correctly.
  it('passes the audit log page through the activity mapper unchanged', async () => {
    const createdAt = new Date('2026-10-01T00:00:00.000Z');
    auditLogQueryService.listAllForAdmin.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          actorName: 'Mod One',
          action: 'POST_HIDDEN',
          targetType: 'POST',
          targetId: 'post-1',
          metadata: { authorId: 'author-1', postTitle: 'Version guide' },
          createdAt,
        },
      ],
      meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
    });

    const result = await service.getOverview();

    expect(auditLogQueryService.listAllForAdmin).toHaveBeenCalledWith({
      page: 1,
      limit: 8,
    });
    expect(result.activity).toEqual([
      {
        id: 'log-1',
        actorName: 'Mod One',
        action: 'POST_HIDDEN',
        targetType: 'POST',
        targetId: 'post-1',
        targetName: 'Version guide',
        occurredAt: createdAt,
      },
    ]);
  });

  it('resolves USER-targeted entries via one batch lookup, not one per row', async () => {
    auditLogQueryService.listAllForAdmin.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          actorName: 'Admin One',
          action: 'USER_BANNED',
          targetType: 'USER',
          targetId: 'user-1',
          metadata: { previousStatus: 'ACTIVE' },
          createdAt: new Date(),
        },
        {
          id: 'log-2',
          actorName: 'Admin One',
          action: 'MODERATOR_ASSIGNED',
          targetType: 'USER',
          targetId: 'user-2',
          metadata: undefined,
          createdAt: new Date(),
        },
      ],
      meta: { page: 1, limit: 8, total: 2, totalPages: 1 },
    });
    usersRepository.findManyNamesByIds.mockResolvedValue([
      { id: 'user-1', name: 'Rover' },
    ]);

    const result = await service.getOverview();

    expect(usersRepository.findManyNamesByIds).toHaveBeenCalledTimes(1);
    expect(usersRepository.findManyNamesByIds).toHaveBeenCalledWith([
      'user-1',
      'user-2',
    ]);
    expect(result.activity[0].targetName).toBe('Rover');
    // user-2's name wasn't in the lookup result (e.g. account since deleted).
    expect(result.activity[1].targetName).toBeNull();
  });
});
