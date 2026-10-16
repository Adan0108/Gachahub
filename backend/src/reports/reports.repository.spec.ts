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
    prisma.$transaction.mockImplementation((work) => work(tx));
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
