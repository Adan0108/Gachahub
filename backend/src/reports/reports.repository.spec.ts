import { decodeCaseCursor } from './domain/case-cursor';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ConflictException } from '@nestjs/common';
import { Prisma, ReportReason } from '../generated/prisma/client';
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
    $executeRaw: jest.fn(),
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
    tx.report.create.mockResolvedValue({
      id: 'report',
      caseId: 'case',
      targetType: 'POST',
      targetId: 'post',
    });
    tx.report.count.mockResolvedValue(3);
    tx.report.findMany.mockResolvedValue([
      { reporterId: 'a' },
      { reporterId: 'b' },
    ]);
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      id: 'report',
      caseId: 'case',
    });
    expect(report).not.toHaveProperty('targetSnapshot');
    expect(report).not.toHaveProperty('status');
    expect(tx.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          caseId: true,
          reporterId: true,
          targetType: true,
          targetId: true,
          reasonCode: true,
          details: true,
          createdAt: true,
        },
      }),
    );
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
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('ReportsRepository direct case transitions', () => {
  const tx = {
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    moderationCase: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const audit = jest.fn();
  const repository = new ReportsRepository(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    tx.moderationCase.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUnique.mockResolvedValue({
      role: 'PLATFORM_MODERATOR',
      status: 'ACTIVE',
    });
    tx.$queryRaw.mockResolvedValue([]);
    tx.moderationCase.findUniqueOrThrow.mockResolvedValue({
      id: 'case',
      status: 'IN_REVIEW',
      gameId: null,
    });
  });
  it.each([undefined, 'game'])(
    'claims case directly with authoritative scope %s and atomic audit',
    async (gameId) => {
      const result = await repository.claimCase('case', 'mod', {
        actorId: 'mod',
        caseGameId: gameId ?? null,
        gameId,
        audit,
      });
      expect(tx.moderationCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'case',
          gameId: gameId ?? null,
          status: { in: ['OPEN'] },
        },
        data: { status: 'IN_REVIEW', assignedModeratorId: 'mod' },
      });
      expect(tx.moderationCase.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'case' } }),
      );
      expect(audit).toHaveBeenCalledWith(result, tx);
      expect(
        tx.moderationCase.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(audit.mock.invocationCallOrder[0]);
    },
  );
  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'finalizes native case as %s without changing counts/assignment',
    async (status) => {
      await repository.finalizeCase(
        { id: 'case', status, resolvedById: 'other', resolutionNote: 'Done' },
        { actorId: 'other', caseGameId: 'game', gameId: 'game', audit },
      );
      expect(tx.moderationCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'case',
          gameId: 'game',
          status: { in: ['OPEN', 'IN_REVIEW'] },
        },
        data: {
          status,
          resolvedById: 'other',
          resolutionNote: 'Done',
          resolvedAt: expect.any(Date) as Date,
        },
      });
      expect(audit).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['claim', 'resolve', 'dismiss'])(
    'does not audit or reload losing/missing %s updates',
    async (action) => {
      tx.moderationCase.updateMany.mockResolvedValue({ count: 0 });
      const result =
        action === 'claim'
          ? await repository.claimCase('case', 'mod', {
              actorId: 'mod',
              caseGameId: null,
              audit,
            })
          : await repository.finalizeCase(
              {
                id: 'case',
                status: action === 'resolve' ? 'RESOLVED' : 'DISMISSED',
                resolvedById: 'mod',
              },
              { actorId: 'mod', caseGameId: null, audit },
            );
      expect(result).toBeNull();
      expect(tx.moderationCase.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );
  it('propagates audit failure out of the same transaction', async () => {
    const error = new Error('audit failed');
    audit.mockRejectedValue(error);
    await expect(
      repository.claimCase('case', 'mod', {
        actorId: 'mod',
        caseGameId: null,
        audit,
      }),
    ).rejects.toBe(error);
  });
});

describe('ReportsRepository native case reads', () => {
  const prisma = {
    moderationCase: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    report: { findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
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
    prisma.report.groupBy.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
  });
  it.each([20, 50])(
    'enriches %i cases with one target batch and one reason aggregation',
    async (size) => {
      const items = Array.from({ length: size }, (_, i) => ({
        id: `case-${i}`,
        targetType: i % 2 ? 'COMMENT' : 'POST',
        targetId: `target-${i}`,
        createdAt: new Date(),
      }));
      prisma.moderationCase.findMany.mockResolvedValue(items);
      await repository.findModerationCases({
        limit: size,
      });
      expect(prisma.moderationCase.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.moderationCase.count).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.report.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.report.groupBy).toHaveBeenCalledWith({
        by: ['caseId', 'reasonCode'],
        where: { caseId: { in: items.map((item) => item.id) } },
        _count: { _all: true },
      });
      expect(prisma.post.findUnique).not.toHaveBeenCalled();
      expect(prisma.comment.findUnique).not.toHaveBeenCalled();
      expect(prisma.report.findMany).not.toHaveBeenCalled();
    },
  );
  it('merges typed previews, safe missing/deleted states and ordered evidence-derived reasons', async () => {
    prisma.moderationCase.findMany.mockResolvedValue([
      { id: 'a', targetType: 'POST', targetId: 'same', gameId: null },
      { id: 'b', targetType: 'COMMENT', targetId: 'same' },
      { id: 'c', targetType: 'POST', targetId: 'deleted' },
      { id: 'd', targetType: 'POST', targetId: 'missing' },
    ]);
    const author = {
      id: 'author',
      name: 'Author',
      username: 'author',
      image: null,
    };
    prisma.$queryRaw.mockResolvedValue([
      {
        targetType: 'POST',
        targetId: 'same',
        deleted: false,
        title: 'Post title',
        excerpt: 'Excerpt',
        thumbnailUrl: 'https://example.com/image.png',
        author,
      },
      {
        targetType: 'COMMENT',
        targetId: 'same',
        deleted: false,
        title: null,
        excerpt: 'Comment excerpt',
        thumbnailUrl: null,
        author,
      },
      {
        targetType: 'POST',
        targetId: 'deleted',
        deleted: true,
        title: 'Deleted secret',
      },
    ]);
    prisma.report.groupBy.mockResolvedValue([
      { caseId: 'a', reasonCode: 'OTHER', _count: { _all: 1 } },
      { caseId: 'a', reasonCode: 'HATE', _count: { _all: 2 } },
      { caseId: 'a', reasonCode: 'HARASSMENT', _count: { _all: 2 } },
    ]);
    const { items } = await repository.findModerationCases({
      limit: 20,
    });
    expect(items[0]).toMatchObject({
      gameId: null,
      targetPreview: { title: 'Post title', author },
      reasonSummary: [
        { reasonCode: 'HARASSMENT', count: 2 },
        { reasonCode: 'HATE', count: 2 },
        { reasonCode: 'OTHER', count: 1 },
      ],
    });
    expect(items[1].targetPreview?.excerpt).toBe('Comment excerpt');
    expect(items[2]).toMatchObject({
      targetState: 'deleted',
      targetPreview: null,
    });
    expect(items[3]).toMatchObject({
      targetState: 'missing',
      targetPreview: null,
      reasonSummary: [],
    });
    for (const item of items) {
      expect(item).not.toHaveProperty('reports');
      expect(item).not.toHaveProperty('targetSnapshot');
    }
  });
  it('uses an exclusive tuple boundary, one lookahead and no OFFSET/count without a pagination mode', async () => {
    const lastReportedAt = new Date('2026-10-20T00:00:00.000Z');
    prisma.moderationCase.findMany.mockResolvedValue(
      ['z', 'y', 'x'].map((id) => ({
        id,
        targetType: 'POST',
        targetId: id,
        lastReportedAt,
      })),
    );
    const result = await repository.findModerationCases({
      limit: 2,

      cursor: { id: 'zz', lastReportedAt },
      gameId: 'game',
    });
    expect(result.items.map((item) => item.id)).toEqual(['z', 'y']);
    expect(decodeCaseCursor(result.nextCursor!)).toEqual({
      id: 'y',
      lastReportedAt,
    });
    const [args] = prisma.moderationCase.findMany.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(args).toMatchObject({
      take: 3,
      where: {
        gameId: 'game',
        OR: [
          { lastReportedAt: { lt: lastReportedAt } },
          { lastReportedAt, id: { lt: 'zz' } },
        ],
      },
    });
    expect(args).not.toHaveProperty('skip');
    expect(prisma.moderationCase.count).not.toHaveBeenCalled();
  });
  it('does no enrichment work for an empty page', async () => {
    prisma.moderationCase.findMany.mockResolvedValue([]);
    expect(
      await repository.findModerationCases({
        limit: 20,
      }),
    ).toMatchObject({ items: [], nextCursor: null });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.report.groupBy).not.toHaveBeenCalled();
  });
  it('returns at most one aggregate per enum reason regardless of complaint counts', async () => {
    prisma.report.groupBy.mockResolvedValue(
      Object.values(ReportReason).map((reasonCode) => ({
        caseId: 'case',
        reasonCode,
        _count: { _all: 10000 },
      })),
    );
    const summaries = await repository.findCaseReasonSummaries(['case']);
    expect(summaries.get('case')).toHaveLength(10);
    expect(summaries.get('case')?.every((item) => item.count === 10000)).toBe(
      true,
    );
  });
  it.each([undefined, null, 'game'])(
    'lists cases with exact game scope %s and native filters',
    async (gameId) => {
      const result = await repository.findModerationCases({
        gameId,
        status: 'OPEN',
        targetType: 'POST',

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
          take: 11,
          orderBy: [{ lastReportedAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(prisma.moderationCase.count).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('total');
      expect(result).not.toHaveProperty('meta');
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
        nextCursor: null,
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
