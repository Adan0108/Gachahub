import { PlatformModeratorsService } from './platform-moderators.service';

describe('PlatformModeratorsService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    gameModerator: { findMany: jest.fn() },
    moderationCase: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const audit = { recordOrThrow: jest.fn() };
  const service = new PlatformModeratorsService(
    prisma as never,
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUnique
      .mockResolvedValueOnce({ role: 'ADMIN', status: 'ACTIVE' })
      .mockResolvedValueOnce({
        id: 'mod-1',
        role: 'PLATFORM_MODERATOR',
        status: 'ACTIVE',
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('on revoke, hands back their open cases except in games they still moderate', async () => {
    tx.gameModerator.findMany.mockResolvedValue([{ gameId: 'game-ww' }]);

    await service.change('admin-1', 'mod-1', false);

    expect(tx.moderationCase.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [{ gameId: null }, { gameId: { notIn: ['game-ww'] } }],
        assignedModeratorId: 'mod-1',
        status: { in: ['OPEN', 'IN_REVIEW'] },
      },
      data: { assignedModeratorId: null, status: 'OPEN' },
    });
  });
});
