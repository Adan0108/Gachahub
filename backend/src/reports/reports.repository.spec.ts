jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ReportsRepository } from './reports.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { PostReportSnapshot } from './report-target-snapshot';

describe('ReportsRepository creation retry boundaries', () => {
  const snapshot: PostReportSnapshot = {
    version: 1,
    targetType: 'POST',
    postId: 'post',
    authorId: 'author',
    title: '',
    content: 'Evidence',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    gameId: null,
    type: null,
    categoryId: null,
    media: [],
  };
  const params = {
    gameId: null,
    reporterId: 'reporter',
    targetType: 'POST' as const,
    targetId: 'post',
    reasonCode: 'OTHER' as const,
    snapshot,
  };
  const workflow = {
    id: 'case',
    status: 'OPEN',
    targetType: 'POST',
    targetId: 'post',
    gameId: null,
    game: null,
    updatedAt: new Date(),
  };
  const tx = {
    moderationCase: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    report: {
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = { $transaction: jest.fn() };
  const repository = new ReportsRepository(prisma as unknown as PrismaService);
  const unique = () =>
    new Prisma.PrismaClientKnownRequestError('unique conflict', {
      code: 'P2002',
      clientVersion: 'test',
    });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    tx.moderationCase.findFirst.mockResolvedValue(workflow);
    tx.moderationCase.create.mockResolvedValue(workflow);
    tx.$queryRaw.mockResolvedValue([{ id: workflow.id }]);
    tx.report.findFirst.mockResolvedValue(null);
    tx.report.create.mockResolvedValue({ id: 'report' });
    tx.report.count.mockResolvedValue(3);
    tx.report.findMany.mockResolvedValue([
      { reporterId: 'a' },
      { reporterId: 'b' },
    ]);
    tx.report.findUniqueOrThrow.mockResolvedValue({
      id: 'report',
      targetSnapshot: snapshot,
      case: workflow,
    });
  });
  it('retries a unique violation in a fresh transaction and re-reads the active case', async () => {
    prisma.$transaction.mockRejectedValueOnce(unique());
    const report = await repository.create(params);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.moderationCase.findFirst).toHaveBeenCalledWith({
      where: {
        targetType: 'POST',
        targetId: 'post',
        status: { in: ['OPEN', 'IN_REVIEW'] },
      },
    });
    expect(tx.moderationCase.update).toHaveBeenCalledWith({
      where: { id: 'case' },
      data: { reportCount: 3, uniqueReporterCount: 2 },
    });
    expect(report).toMatchObject({
      id: 'report',
      gameId: null,
      status: 'PENDING',
    });
    expect(report).not.toHaveProperty('targetSnapshot');
  });
  it('bounds retries and returns a conflict instead of an unexpected unique-error 500', async () => {
    prisma.$transaction.mockRejectedValue(unique());
    await expect(repository.create(params)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
  });
  it('does not swallow or retry non-unique persistence failures', async () => {
    const error = new Error('storage unavailable');
    prisma.$transaction.mockRejectedValueOnce(error);
    await expect(repository.create(params)).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('re-reads when an observed active case closes before its row can be locked', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await repository.create(params);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.report.create).toHaveBeenCalledTimes(1);
  });
  it('checks reporter membership under the row lock before writing anything', async () => {
    tx.report.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(repository.create(params)).rejects.toThrow(
      'You already have an open report on this content',
    );
    expect(tx.report.create).not.toHaveBeenCalled();
    expect(tx.moderationCase.update).not.toHaveBeenCalled();
  });
});

describe('ReportsRepository case transitions', () => {
  const tx = {
    report: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    moderationCase: { updateMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const audit = jest.fn();
  const context = { gameId: 'game', audit };
  const repository = new ReportsRepository(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    tx.report.findUnique.mockResolvedValue({ caseId: 'shared-case' });
    tx.moderationCase.updateMany.mockResolvedValue({ count: 1 });
    tx.report.findUniqueOrThrow.mockResolvedValue({
      id: 'report',
      caseId: 'shared-case',
      targetSnapshot: { secret: 'evidence' },
      case: { status: 'IN_REVIEW', gameId: 'game' },
    });
  });
  it('claims the report case with an OPEN-only scoped conditional update and audits inside the transaction', async () => {
    const result = await repository.claim('report', 'moderator', context);
    expect(tx.moderationCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'shared-case', gameId: 'game', status: { in: ['OPEN'] } },
      data: { status: 'IN_REVIEW', assignedModeratorId: 'moderator' },
    });
    expect(audit).toHaveBeenCalledWith(result, tx);
    expect(result).not.toHaveProperty('targetSnapshot');
    expect(
      tx.moderationCase.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(audit.mock.invocationCallOrder[0]);
  });
  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'finalizes as %s without modifying assignment or complaint counts',
    async (status) => {
      await repository.finalize(
        {
          id: 'report',
          status,
          resolvedById: 'other-mod',
          resolutionNote: 'Reviewed',
        },
        context,
      );
      expect(tx.moderationCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'shared-case',
          gameId: 'game',
          status: { in: ['OPEN', 'IN_REVIEW'] },
        },
        data: {
          status,
          resolvedById: 'other-mod',
          resolutionNote: 'Reviewed',
          resolvedAt: expect.any(Date) as Date,
        },
      });
      expect(audit).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['claim', 'resolve', 'dismiss'])(
    'does not audit or reload after a failed %s transition',
    async (action) => {
      tx.moderationCase.updateMany.mockResolvedValue({ count: 0 });
      const result =
        action === 'claim'
          ? await repository.claim('report', 'mod', context)
          : await repository.finalize(
              {
                id: 'report',
                status: action === 'resolve' ? 'RESOLVED' : 'DISMISSED',
                resolvedById: 'mod',
              },
              context,
            );
      expect(result).toBeNull();
      expect(audit).not.toHaveBeenCalled();
      expect(tx.report.findUniqueOrThrow).not.toHaveBeenCalled();
    },
  );
  it('does not update or audit a missing report', async () => {
    tx.report.findUnique.mockResolvedValue(null);
    expect(await repository.claim('missing', 'mod', context)).toBeNull();
    expect(tx.moderationCase.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it('propagates audit rejection from the transaction callback', async () => {
    const error = new Error('audit unavailable');
    audit.mockRejectedValueOnce(error);
    await expect(repository.claim('report', 'mod', context)).rejects.toBe(
      error,
    );
  });
});
