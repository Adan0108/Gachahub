import {
  CLAIMED_KEY_PACKAGE_RETENTION_MS,
  COMMIT_FAULT_RETENTION_MS,
  CONSUMED_WELCOME_RETENTION_MS,
  MlsRetentionService,
  PRUNE_BATCH_SIZE,
} from './mls-retention.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function delegate() {
  return { findMany: jest.fn(), deleteMany: jest.fn() };
}

describe('MlsRetentionService', () => {
  const prisma = {
    mlsWelcome: delegate(),
    mlsCommitFault: delegate(),
    mlsKeyPackage: delegate(),
  };
  const discordLogger = { sendError: jest.fn() };
  let service: MlsRetentionService;

  function idle() {
    for (const table of [
      prisma.mlsWelcome,
      prisma.mlsCommitFault,
      prisma.mlsKeyPackage,
    ]) {
      table.findMany.mockResolvedValue([]);
      table.deleteMany.mockResolvedValue({ count: 0 });
    }
  }

  beforeEach(() => {
    jest.resetAllMocks();
    idle();
    service = new MlsRetentionService(prisma as any, discordLogger as any);
  });

  it('prunes consumed welcomes only past 30 days', async () => {
    await service.pruneMlsTables();

    const [first] = prisma.mlsWelcome.findMany.mock.calls[0] as [
      { where: { consumedAt: { lt: Date } }; take: number },
    ];
    const ageDays = (Date.now() - first.where.consumedAt.lt.getTime()) / DAY_MS;
    expect(Math.round(ageDays)).toBe(CONSUMED_WELCOME_RETENTION_MS / DAY_MS);
    expect(first.take).toBe(PRUNE_BATCH_SIZE);
  });

  it('prunes unconsumed welcomes of revoked devices, never of active ones', async () => {
    await service.pruneMlsTables();

    expect(prisma.mlsWelcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          consumedAt: null,
          recipientDevice: { revokedAt: { not: null } },
        },
      }),
    );
  });

  it('prunes commit faults past 180 days', async () => {
    await service.pruneMlsTables();

    const [args] = prisma.mlsCommitFault.findMany.mock.calls[0] as [
      { where: { createdAt: { lt: Date } } },
    ];
    const ageDays = (Date.now() - args.where.createdAt.lt.getTime()) / DAY_MS;
    expect(Math.round(ageDays)).toBe(COMMIT_FAULT_RETENTION_MS / DAY_MS);
  });

  it('prunes only claimed single-use key packages past 30 days', async () => {
    await service.pruneMlsTables();

    const [args] = prisma.mlsKeyPackage.findMany.mock.calls[0] as [
      { where: { kind: string; claimedAt: { lt: Date } } },
    ];
    const ageDays = (Date.now() - args.where.claimedAt.lt.getTime()) / DAY_MS;
    expect(args.where.kind).toBe('SINGLE_USE');
    expect(Math.round(ageDays)).toBe(CLAIMED_KEY_PACKAGE_RETENTION_MS / DAY_MS);
  });

  it('deletes only the ids it selected', async () => {
    prisma.mlsCommitFault.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    prisma.mlsCommitFault.deleteMany.mockResolvedValue({ count: 2 });

    await service.pruneMlsTables();

    expect(prisma.mlsCommitFault.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.mlsCommitFault.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
    });
  });

  it('keeps deleting while batches come back full, then stops', async () => {
    prisma.mlsCommitFault.findMany.mockResolvedValue([{ id: 'a' }]);
    prisma.mlsCommitFault.deleteMany
      .mockResolvedValueOnce({ count: PRUNE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: PRUNE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 3 });

    await service.pruneMlsTables();

    expect(prisma.mlsCommitFault.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('a failing rule is reported to discord and the other rules still run', async () => {
    prisma.mlsWelcome.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.pruneMlsTables()).resolves.toBeUndefined();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'cron',
        title: 'Cron job failed: pruneMlsTables',
      }),
    );
    expect(prisma.mlsCommitFault.findMany).toHaveBeenCalled();
  });

  it('reports nothing when there is nothing to prune', async () => {
    await service.pruneMlsTables();

    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });
});
