jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ReportsRepository } from './reports.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { PostReportSnapshot } from './domain/report-target-snapshot';

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

describe('ReportsRepository queue filters', () => {
  it.each([undefined, null, 'game-1'])(
    'preserves gameId %s semantics, filters, order and pagination',
    async (gameId) => {
      const row = {
        id: 'report',
        targetSnapshot: { secret: true },
        case: { gameId, status: 'OPEN' },
      };
      const prisma = {
        report: {
          findMany: jest
            .fn()
            .mockResolvedValue([row, { ...row, id: 'report-2' }]),
          count: jest.fn().mockResolvedValue(2),
        },
        $transaction: jest.fn((queries: Promise<unknown>[]) =>
          Promise.all(queries),
        ),
      };
      const repository = new ReportsRepository(
        prisma as unknown as PrismaService,
      );
      const result = await repository.findMany({
        gameId,
        status: 'PENDING',
        targetType: 'POST',
        page: 2,
        limit: 10,
      });
      const where = {
        case: { ...(gameId !== undefined ? { gameId } : {}), status: 'OPEN' },
        targetType: 'POST',
      };
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          skip: 10,
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(prisma.report.count).toHaveBeenCalledWith({ where });
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].status).toBe('PENDING');
      expect(result.items[0]).not.toHaveProperty('targetSnapshot');
      expect(result.items[0]).not.toHaveProperty('case');
    },
  );
});

describe('ReportsRepository native case reads', () => {
  const prisma = {
    moderationCase: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    report: { findMany: jest.fn() },
    post: { findUnique: jest.fn() },
    comment: { findUnique: jest.fn() },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const repository = new ReportsRepository(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    prisma.moderationCase.findMany.mockResolvedValue([
      { id: 'case', status: 'OPEN', reportCount: 3 },
    ]);
    prisma.moderationCase.count.mockResolvedValue(1);
  });
  it.each([undefined, null, 'game'])(
    'lists/counts cases with exact game scope %s and native filters',
    async (gameId) => {
      const result = await repository.findModerationCases({
        gameId,
        status: 'OPEN',
        targetType: 'POST',
        page: 2,
        limit: 10,
      });
      const where = {
        ...(gameId !== undefined ? { gameId } : {}),
        status: 'OPEN',
        targetType: 'POST',
      };
      expect(prisma.moderationCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          skip: 10,
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(prisma.moderationCase.count).toHaveBeenCalledWith({ where });
      const [query] = prisma.moderationCase.findMany.mock
        .calls[0] as unknown as [{ select: Record<string, unknown> }];
      expect(query.select).toMatchObject({
        reportCount: true,
        uniqueReporterCount: true,
        assignedModerator: { select: { id: true, name: true, image: true } },
        game: { select: { id: true, name: true, slug: true } },
      });
      for (const excluded of ['reports', 'targetSnapshot', 'resolutionNote'])
        expect(query.select).not.toHaveProperty(excluded);
      expect(prisma.report.findMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        total: 1,
        items: [{ status: 'OPEN', reportCount: 3 }],
      });
    },
  );
  it('loads exact case detail including nullable game and resolution metadata through an allowlist', async () => {
    const detail = {
      id: 'case',
      game: null,
      assignedModerator: { id: 'mod' },
      resolvedBy: { id: 'admin' },
      resolutionNote: 'done',
    };
    prisma.moderationCase.findUnique.mockResolvedValue(detail);
    expect(await repository.findModerationCaseById('case')).toEqual(detail);
    expect(prisma.moderationCase.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case' },
        select: expect.objectContaining({
          resolutionNote: true,
          resolvedById: true,
          resolvedBy: { select: { id: true, name: true, image: true } },
        }) as unknown,
      }),
    );
    prisma.moderationCase.findUnique.mockResolvedValue(null);
    expect(await repository.findModerationCaseById('missing')).toBeNull();
  });
  it('bounds evidence with one lookahead and never returns raw snapshot fields', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const row = {
      id: 'z',
      createdAt,
      reporter: { id: 'user', name: 'Name', image: null },
      reasonCode: 'OTHER',
      details: null,
      targetType: 'POST',
      targetId: 'post',
      targetSnapshot: {
        version: 1,
        targetType: 'POST',
        postId: 'post',
        content: 'evidence',
        secret: 'private',
      },
    };
    prisma.report.findMany.mockResolvedValue([
      row,
      { ...row, id: 'y' },
      { ...row, id: 'x' },
    ]);
    const result = await repository.findReportsByCaseId('case', 2);
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { caseId: 'case' },
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      snapshot: { content: 'evidence' },
    });
    expect(result.items[0]).not.toHaveProperty('targetSnapshot');
    expect(result.items[0].snapshot).not.toHaveProperty('secret');
    expect(result.nextCursor).not.toBeNull();
    prisma.report.findMany.mockResolvedValue([]);
    expect(
      await repository.findReportsByCaseId('case', 2, { id: 'y', createdAt }),
    ).toEqual({ items: [], nextCursor: null });
    expect(prisma.report.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          caseId: 'case',
          OR: [
            { createdAt: { lt: createdAt } },
            { createdAt, id: { lt: 'y' } },
          ],
        },
      }),
    );
  });
  it('returns no continuation when the evidence page ends exactly at its limit', async () => {
    prisma.report.findMany.mockResolvedValue([
      {
        id: 'report',
        createdAt: new Date(),
        targetType: 'POST',
        targetId: 'post',
        targetSnapshot: null,
      },
    ]);
    const result = await repository.findReportsByCaseId('case', 1);
    expect(result.nextCursor).toBeNull();
    expect(result.items[0].snapshot).toBeNull();
  });
  it.each(['POST', 'COMMENT'] as const)(
    'preserves cases with missing %s target content',
    async (type) => {
      prisma.post.findUnique.mockResolvedValue(null);
      prisma.comment.findUnique.mockResolvedValue(null);
      expect(await repository.findCaseTarget(type, 'missing')).toEqual({
        target: null,
        targetState: 'missing',
      });
    },
  );
  it('represents soft-deleted posts and comments with deleted parents explicitly', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post',
      deletedAt: new Date(),
      status: 'DELETED',
    });
    expect(await repository.findCaseTarget('POST', 'post')).toMatchObject({
      targetState: 'deleted',
      target: { id: 'post' },
    });
    prisma.comment.findUnique.mockResolvedValue({
      id: 'comment',
      deletedAt: null,
      post: { deletedAt: new Date(), status: 'DELETED' },
    });
    expect(await repository.findCaseTarget('COMMENT', 'comment')).toMatchObject(
      { targetState: 'deleted', target: { id: 'comment' } },
    );
    expect(prisma.post.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          media: {
            take: 20,
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { url: true, mediaType: true, altText: true },
          },
        }) as unknown,
      }),
    );
  });
});
