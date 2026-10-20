import { isolatedCaseDatabase } from './support/isolated-case-database';
import { PlatformCaseModerationController } from '../src/reports/platform-moderation/platform-case-moderation.controller';
type TestRequest = Request & {
  user?: { id: string };
  session?: { user: { id: string } };
};

type ApiBody = {
  id: string;
  caseId: string;
  status: string;
  assignedModeratorId: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  message: string | string[];
  items: Array<{ id: string; [key: string]: unknown }>;
  metrics: Array<{ id: string; value: number }>;
  meta: { total: number };
  reportCount: number;
  uniqueReporterCount: number;
  target: { content?: string; targetType: string } | null;
  targetState: string;
  evidence: {
    items: Array<{ id: string; snapshot: { content: string } | null }>;
    nextCursor: string | null;
  };
  nextCursor: string | null;
};

jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    Session: () =>
      common.createParamDecorator(
        (_: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest<TestRequest>().session,
      )(),
  };
});
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import {
  ValidationPipe,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { ReportsRepository } from '../src/reports/reports.repository';
import { ReportRateLimiterService } from '../src/reports/infrastructure/report-rate-limiter.service';
import { GameCaseModerationController } from '../src/reports/game-moderation/game-case-moderation.controller';
import { ReportModerationService } from '../src/reports/moderation/report-moderation.service';
import { PostVisibilityService } from '../src/post-visibility/post-visibility.service';
import { FollowsService } from '../src/follows/follows.service';
import { FollowsRepository } from '../src/follows/follows.repository';
import { EventPublisherPort } from '../src/domain-events/event-publisher.port';
import { GameModeratorsService } from '../src/game-moderators/game-moderators.service';
import { GameModeratorsRepository } from '../src/game-moderators/game-moderators.repository';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import { AuditLogRepository } from '../src/audit-log/audit-log.repository';
import { AuditLogQueryService } from '../src/audit-log/audit-log-query.service';
import { DiscordLoggerService } from '../src/common/discord/discord-logger.service';
import { ContentModerationService } from '../src/content-moderation/content-moderation.service';
import { AdminContentController } from '../src/content-moderation/admin-content.controller';
import { PostsRepository } from '../src/posts/posts.repository';
import { CommentsRepository } from '../src/comments/comments.repository';
import { OverviewService } from '../src/overview/overview.service';
import { AdminOverviewController } from '../src/overview/admin-overview.controller';
import { GamesRepository } from '../src/games/games.repository';
import { UsersRepository } from '../src/users/users.repository';

// Real HTTP, validation, account/visibility policy, PostgreSQL transactions,
// row locks and partial index. Auth sessions are injected. No Kafka, Redis,
// Cloudinary or background workers are started; failures are explicitly injected.
describe('Report creation and case workflow (real PostgreSQL)', () => {
  jest.setTimeout(120_000);
  const prefix = `report-stage-a-${randomUUID()}`;
  const author = `${prefix}-author`;
  const commenter = `${prefix}-commenter`;
  const admin = `${prefix}-admin`;
  const moderator = `${prefix}-mod`;
  const secondModerator = `${prefix}-mod-2`;
  const userIds = new Set([
    author,
    commenter,
    admin,
    moderator,
    secondModerator,
  ]);
  const targets = new Set<string>();
  let app: INestApplication;
  let db: PrismaService;
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let gameId: string;
  const slug = prefix;
  let baseUrl: string;

  async function user() {
    const id = `${prefix}-${randomUUID()}`;
    userIds.add(id);
    await db.user.create({
      data: { id, name: 'Reporter', email: `${id}@example.invalid` },
    });
    return id;
  }
  async function post(game = false, extra: Record<string, unknown> = {}) {
    const row = await db.post.create({
      data: {
        authorId: author,
        title: game ? 'Community evidence' : '',
        content: 'Original evidence',
        gameId: game ? gameId : null,
        type: game ? 'GUIDE' : null,
        ...extra,
      },
    });
    targets.add(row.id);
    return row;
  }
  async function comment(postId: string, extra: Record<string, unknown> = {}) {
    const row = await db.comment.create({
      data: {
        postId,
        authorId: commenter,
        content: 'Comment evidence',
        ...extra,
      },
    });
    targets.add(row.id);
    return row;
  }
  async function api(
    path: string,
    as: string | null,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(as ? { 'x-test-user': as } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as ApiBody,
    };
  }
  const submit = (
    targetId: string,
    reporterId: string,
    targetType: 'POST' | 'COMMENT' = 'POST',
    extra = {},
  ) =>
    api('/reports', reporterId, {
      targetType,
      targetId,
      reasonCode: 'HARASSMENT',
      ...extra,
    });
  const cases = (targetId: string) =>
    db.moderationCase.findMany({ where: { targetId } });
  async function persistedReport(id: string) {
    return db.report.findUniqueOrThrow({ where: { id } });
  }

  // Test-only transaction barriers preserve all production queries. They allow
  // deterministic first-case races and failures without touching unrelated rows.
  function intercept(
    makeClient: (tx: Prisma.TransactionClient) => Prisma.TransactionClient,
    onError?: (error: unknown) => void,
  ) {
    const transaction = db.$transaction.bind(
      db,
    ) as PrismaService['$transaction'];
    return jest
      .spyOn(db, '$transaction')
      .mockImplementation((work: unknown, options: unknown) => {
        if (typeof work !== 'function')
          return transaction(work as never, options as never);
        return transaction(
          (tx) =>
            (work as (client: Prisma.TransactionClient) => Promise<unknown>)(
              makeClient(tx),
            ),
          options as never,
        ).catch((error) => {
          onError?.(error);
          throw error;
        });
      });
  }

  beforeAll(async () => {
    isolated = await isolatedCaseDatabase();
    const module = await Test.createTestingModule({
      controllers: [
        ReportsController,
        PlatformCaseModerationController,
        GameCaseModerationController,
        AdminContentController,
        AdminOverviewController,
      ],
      providers: [
        { provide: PrismaService, useValue: isolated.prisma },
        ReportsService,
        ReportsRepository,
        ReportRateLimiterService,
        ReportModerationService,
        PostVisibilityService,
        FollowsService,
        FollowsRepository,
        GameModeratorsService,
        GameModeratorsRepository,
        AuditLogService,
        AuditLogRepository,
        AuditLogQueryService,
        ContentModerationService,
        PostsRepository,
        CommentsRepository,
        OverviewService,
        GamesRepository,
        UsersRepository,
        {
          provide: EventPublisherPort,
          useValue: {
            publish: () => {
              throw new Error('Report creation must not publish events');
            },
          },
        },
        {
          provide: DiscordLoggerService,
          useValue: { sendError: () => Promise.resolve() },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: TestRequest, _res: unknown, next: () => void) => {
      const header = req.headers['x-test-user'];
      const id = typeof header === 'string' ? header : undefined;
      req.user = id ? { id } : undefined;
      req.session = id ? { user: { id } } : undefined;
      next();
    });
    app.useGlobalGuards({
      canActivate: (context) => {
        if (!context.switchToHttp().getRequest<TestRequest>().session)
          throw new UnauthorizedException();
        return true;
      },
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    db = app.get(PrismaService);
    await db.user.createMany({
      data: [...userIds].map((id) => ({
        id,
        name: 'Stage A fixture',
        email: `${id}@example.invalid`,
        role: id === admin ? 'ADMIN' : 'USER',
      })),
    });
    gameId = (await db.game.create({ data: { name: 'Stage A fixture', slug } }))
      .id;
    await db.gameModerator.createMany({
      data: [moderator, secondModerator].map((userId) => ({ gameId, userId })),
    });
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.auditLog.deleteMany({
          where: { actorId: { in: [...userIds] } },
        });
        await db.moderationCase.deleteMany({
          where: { targetId: { in: [...targets] } },
        });
        await db.post.deleteMany({ where: { authorId: author } });
        await db.user.deleteMany({ where: { id: { in: [...userIds] } } });
        await db.game.deleteMany({ where: { slug } });
      }
    } finally {
      try {
        await app?.close();
      } finally {
        await isolated?.cleanup();
      }
    }
  });

  it('has the real active-target partial unique index', async () => {
    const rows = await db.$queryRaw<
      Array<{ indexdef: string }>
    >`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'moderation_cases_open_target_key'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('OPEN');
    expect(rows[0].indexdef).toContain('IN_REVIEW');
  });

  it.each([
    [false, 'POST'],
    [true, 'POST'],
    [false, 'COMMENT'],
    [true, 'COMMENT'],
  ] as const)(
    'creates complaint/evidence/case atomically: game=%s target=%s',
    async (game, targetType) => {
      const source = await post(game);
      const target = targetType === 'POST' ? source : await comment(source.id);
      const reporter = await user();
      const response = await submit(target.id, reporter, targetType, {
        details: '  Evidence details  ',
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        targetType,
        targetId: target.id,
        reporterId: reporter,
        details: 'Evidence details',
      });
      expect(response.body).not.toHaveProperty('targetSnapshot');
      expect(response.body).not.toHaveProperty('status');
      expect(response.body).not.toHaveProperty('assignedModeratorId');
      const report = await persistedReport(response.body.id);
      expect(report).toMatchObject({
        caseId: response.body.caseId,
        targetType,
        targetId: target.id,
        reasonCode: 'HARASSMENT',
      });
      expect(report.targetSnapshot).toMatchObject({
        version: 1,
        targetType,
        gameId: game ? gameId : null,
        authorId: targetType === 'POST' ? author : commenter,
        content: target.content,
      });
      if (targetType === 'POST')
        expect(report.targetSnapshot).toMatchObject({
          postId: source.id,
          title: source.title,
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          type: game ? 'GUIDE' : null,
          categoryId: null,
          media: [],
        });
      else
        expect(report.targetSnapshot).toMatchObject({
          commentId: target.id,
          postId: source.id,
          parentId: null,
        });
      expect(await cases(target.id)).toEqual([
        expect.objectContaining({
          id: report.caseId,
          gameId: game ? gameId : null,
          targetType,
          targetId: target.id,
          status: 'OPEN',
          reportCount: 1,
          uniqueReporterCount: 1,
          currentRiskScore: null,
          currentRiskLevel: null,
          assignedModeratorId: null,
        }),
      ]);
    },
  );

  it('captures ordered media metadata and immutable content without leaking evidence', async () => {
    const source = await post();
    const upload = await db.mediaUpload.create({
      data: {
        userId: author,
        purpose: 'POST',
        resourceType: 'IMAGE',
        status: 'ATTACHED',
        publicId: `${prefix}/media`,
        assetId: `${prefix}-asset`,
      },
    });
    const media = await db.postMedia.create({
      data: {
        postId: source.id,
        mediaUploadId: upload.id,
        assetId: upload.assetId!,
        publicId: upload.publicId,
        url: 'https://media.example.invalid/evidence.png',
        mediaType: 'IMAGE',
        sortOrder: 2,
        format: 'png',
        width: 400,
        height: 300,
      },
    });
    const response = await submit(source.id, await user());
    expect(response.status).toBe(201);
    const evidence = (await persistedReport(response.body.id)).targetSnapshot;
    expect(evidence).toMatchObject({
      content: 'Original evidence',
      media: [
        expect.objectContaining({
          id: media.id,
          url: media.url,
          publicId: media.publicId,
          sortOrder: 2,
          width: 400,
          height: 300,
          format: 'png',
        }),
      ],
    });
    await db.post.update({
      where: { id: source.id },
      data: { content: 'Later edit' },
    });
    await db.postMedia.update({
      where: { id: media.id },
      data: { url: 'https://media.example.invalid/later.png' },
    });
    expect((await persistedReport(response.body.id)).targetSnapshot).toEqual(
      evidence,
    );
    expect(
      (
        await app
          .get(ReportsRepository)
          .findReportsByCaseId(response.body.caseId, 20)
      ).items[0],
    ).not.toHaveProperty('targetSnapshot');
  });

  it('snapshots reply identity/parent and preserves comment evidence after edits', async () => {
    const source = await post();
    const root = await comment(source.id);
    const reply = await comment(source.id, {
      parentId: root.id,
      content: 'Reply evidence',
    });
    const response = await submit(reply.id, await user(), 'COMMENT');
    expect(response.status).toBe(201);
    const evidence = (await persistedReport(response.body.id)).targetSnapshot;
    expect(evidence).toMatchObject({
      targetType: 'COMMENT',
      commentId: reply.id,
      postId: source.id,
      parentId: root.id,
      authorId: commenter,
      content: 'Reply evidence',
      gameId: null,
    });
    await db.comment.update({
      where: { id: reply.id },
      data: { content: 'Later comment edit' },
    });
    expect((await persistedReport(response.body.id)).targetSnapshot).toEqual(
      evidence,
    );
  });

  it('a failed append preserves an existing case and its original counts', async () => {
    const source = await post();
    const first = await submit(source.id, await user());
    expect(first.status).toBe(201);
    const hook = intercept(
      (tx) =>
        new Proxy(tx, {
          get(target, key): unknown {
            if (key !== 'moderationCase') return Reflect.get(target, key);
            return new Proxy(target.moderationCase, {
              get(owner, method): unknown {
                if (method === 'update')
                  return () => {
                    throw new Error('Injected append counter failure');
                  };
                return Reflect.get(owner, method);
              },
            });
          },
        }),
    );
    try {
      expect((await submit(source.id, await user())).status).toBe(500);
      expect(await cases(source.id)).toEqual([
        expect.objectContaining({
          id: first.body.caseId,
          reportCount: 1,
          uniqueReporterCount: 1,
        }),
      ]);
      expect(
        await db.report.count({ where: { caseId: first.body.caseId } }),
      ).toBe(1);
    } finally {
      hook.mockRestore();
    }
  });

  it.each(['OPEN', 'IN_REVIEW'] as const)(
    'reuses %s case; different users increment counts; duplicate reporter gets friendly 409',
    async (status) => {
      const source = await post();
      const firstUser = await user();
      const first = await submit(source.id, firstUser);
      expect(first.status).toBe(201);
      await db.moderationCase.update({
        where: { id: first.body.caseId },
        data: { status },
      });
      const second = await submit(source.id, await user());
      expect(second.status).toBe(201);
      expect(second.body.caseId).toBe(first.body.caseId);
      const duplicate = await submit(source.id, firstUser);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe(
        'You already have an open report on this content',
      );
      expect(await cases(source.id)).toEqual([
        expect.objectContaining({ reportCount: 2, uniqueReporterCount: 2 }),
      ]);
      expect(
        await db.report.count({ where: { caseId: first.body.caseId } }),
      ).toBe(2);
      await expect(
        db.moderationCase.create({
          data: { targetType: 'POST', targetId: source.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    },
  );

  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'same reporter may report again after %s under a new case',
    async (status) => {
      const source = await post();
      const reporter = await user();
      const first = await submit(source.id, reporter);
      expect(first.status).toBe(201);
      await db.moderationCase.update({
        where: { id: first.body.caseId },
        data: { status },
      });
      const second = await submit(source.id, reporter);
      expect(second.status).toBe(201);
      expect(second.body.caseId).not.toBe(first.body.caseId);
      expect(await cases(source.id)).toHaveLength(2);
      expect(
        (await cases(source.id)).every(
          (row) => row.reportCount === 1 && row.uniqueReporterCount === 1,
        ),
      ).toBe(true);
    },
  );

  it('counts distinct reporters independently from total complaint rows', async () => {
    const source = await post();
    const first = await submit(source.id, await user());
    const saved = await persistedReport(first.body.id);
    // Simulate historical duplicate evidence, not an allowed submission path.
    await db.report.create({
      data: {
        caseId: saved.caseId,
        reporterId: saved.reporterId,
        targetType: saved.targetType,
        targetId: saved.targetId,
        reasonCode: saved.reasonCode,
        targetSnapshot: saved.targetSnapshot!,
      },
    });
    expect((await submit(source.id, await user())).status).toBe(201);
    expect(await cases(source.id)).toEqual([
      expect.objectContaining({ reportCount: 3, uniqueReporterCount: 2 }),
    ]);
  });

  it.each(['report', 'counter'] as const)(
    'rolls back the entire write transaction on injected %s failure',
    async (failure) => {
      const source = await post();
      const hook = intercept(
        (tx) =>
          new Proxy(tx, {
            get(target, key): unknown {
              const delegate = Reflect.get(target, key) as object;
              if (key !== (failure === 'report' ? 'report' : 'moderationCase'))
                return delegate;
              return new Proxy(delegate, {
                get(owner, method): unknown {
                  if (method === (failure === 'report' ? 'create' : 'update'))
                    return () => {
                      throw new Error(`Injected ${failure} write failure`);
                    };
                  return Reflect.get(owner, method);
                },
              });
            },
          }),
      );
      try {
        // Expected infrastructure 500, not an invalid-input error contract.
        expect((await submit(source.id, await user())).status).toBe(500);
        expect(await cases(source.id)).toHaveLength(0);
        expect(await db.report.count({ where: { targetId: source.id } })).toBe(
          0,
        );
      } finally {
        hook.mockRestore();
      }
    },
  );

  it.each([false, true])(
    'concurrent first submissions recover the real unique race: same reporter=%s',
    async (sameReporter) => {
      const source = await post();
      const firstUser = await user();
      const secondUser = sameReporter ? firstUser : await user();
      let arrivals = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let uniqueConflicts = 0;
      const hook = intercept(
        (tx) =>
          new Proxy(tx, {
            get(target, key): unknown {
              if (key !== 'moderationCase') return Reflect.get(target, key);
              return new Proxy(target.moderationCase, {
                get(owner, method): unknown {
                  if (method !== 'findFirst') return Reflect.get(owner, method);
                  return async (args: Prisma.ModerationCaseFindFirstArgs) => {
                    const found = await owner.findFirst(args);
                    if (
                      !found &&
                      args.where?.targetId === source.id &&
                      arrivals < 2
                    ) {
                      arrivals++;
                      if (arrivals === 2) release();
                      await barrier;
                    }
                    return found;
                  };
                },
              });
            },
          }),
        (error) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
            uniqueConflicts++;
        },
      );
      try {
        const results = await Promise.all([
          submit(source.id, firstUser),
          submit(source.id, secondUser),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(
          sameReporter ? [201, 409] : [201, 201],
        );
        expect(uniqueConflicts).toBe(1);
        const expected = sameReporter ? 1 : 2;
        expect(await cases(source.id)).toEqual([
          expect.objectContaining({
            status: 'OPEN',
            reportCount: expected,
            uniqueReporterCount: expected,
          }),
        ]);
        expect(await db.report.count({ where: { targetId: source.id } })).toBe(
          expected,
        );
      } finally {
        release();
        hook.mockRestore();
      }
    },
  );

  it('preserves follow/author visibility and rejects private, missing, deleted and hidden content', async () => {
    const follower = await user();
    await db.userFollow.create({
      data: { followerId: follower, followingId: author },
    });
    const followed = await post(false, { visibility: 'FOLLOWERS_ONLY' });
    expect((await submit(followed.id, follower)).status).toBe(201);
    expect((await submit(followed.id, author)).status).toBe(201);
    expect((await submit(followed.id, await user())).status).toBe(404);
    for (const extra of [
      { visibility: 'PRIVATE' },
      { status: 'DRAFT' },
      { status: 'HIDDEN' },
      { status: 'DELETED', deletedAt: new Date() },
    ]) {
      const source = await post(false, extra);
      expect((await submit(source.id, await user())).status).toBe(404);
      expect((await submit(source.id, author)).status).toBe(404);
      const target = await comment(source.id);
      expect((await submit(target.id, await user(), 'COMMENT')).status).toBe(
        404,
      );
    }
    const source = await post();
    for (const extra of [{ status: 'HIDDEN' }, { deletedAt: new Date() }]) {
      const target = await comment(source.id, extra);
      expect((await submit(target.id, await user(), 'COMMENT')).status).toBe(
        404,
      );
    }
    expect((await submit('missing-target', await user())).status).toBe(404);
    expect(
      (await submit('missing-comment', await user(), 'COMMENT')).status,
    ).toBe(404);
  });

  it('preserves active-account and DTO checks; client cannot supply evidence or case context', async () => {
    const source = await post();
    expect(
      (
        await api('/reports', null, {
          targetType: 'POST',
          targetId: source.id,
          reasonCode: 'OTHER',
        })
      ).status,
    ).toBe(401);
    const inactive = await user();
    await db.user.update({
      where: { id: inactive },
      data: { status: 'SUSPENDED' },
    });
    expect((await submit(source.id, inactive)).status).toBe(403);
    expect((await submit(source.id, `${prefix}-missing-user`)).status).toBe(
      401,
    );
    for (const extra of [
      { gameId },
      { caseId: 'client-case' },
      { targetSnapshot: {} },
      { risk: 9 },
      { assignedModeratorId: admin },
      { targetType: 'USER' },
      { targetId: 17 },
      { targetId: '' },
      { reasonCode: 'INVALID' },
    ]) {
      expect(
        (await submit(source.id, await user(), 'POST', extra)).status,
      ).toBe(400);
    }
    expect(await cases(source.id)).toHaveLength(0);
  });

  it('rate limiter still counts success, duplicate and missing-target attempts before validation', async () => {
    const source = await post();
    const reporter = await user();
    expect(
      (await submit(source.id, reporter, 'POST', { details: '   ' })).status,
    ).toBe(201);
    const report = await db.report.findFirstOrThrow({
      where: { targetId: source.id },
    });
    expect(report.details).toBeNull();
    expect((await submit(source.id, reporter)).status).toBe(409);
    for (let i = 0; i < 3; i++)
      expect((await submit(`missing-${i}`, reporter)).status).toBe(404);
    const limited = await submit('another-missing', reporter);
    expect(limited.status).toBe(429);
    expect(await cases(source.id)).toHaveLength(1);
  });

  describe('native case workflow', () => {
    async function fixture(
      personal = false,
      targetType: 'POST' | 'COMMENT' = 'POST',
    ) {
      const source = await post(!personal);
      const target = targetType === 'POST' ? source : await comment(source.id);
      const first = await submit(target.id, await user(), targetType);
      const second = await submit(target.id, await user(), targetType);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.caseId).toBe(second.body.caseId);
      return {
        source,
        target,
        caseId: first.body.caseId,
        reportIds: [first.body.id, second.body.id],
      };
    }
    const act = (
      caseId: string,
      action: string,
      as = moderator,
      platform = false,
      body = {},
    ) =>
      api(
        platform
          ? `/moderation/cases/${caseId}/${action}`
          : `/games/${slug}/moderation/cases/${caseId}/${action}`,
        as,
        body,
        'PATCH',
      );

    it.each([
      ['resolve', false, false, 'POST'],
      ['resolve', true, false, 'POST'],
      ['dismiss', false, false, 'COMMENT'],
      ['dismiss', true, false, 'COMMENT'],
      ['resolve', true, true, 'COMMENT'],
      ['dismiss', false, true, 'POST'],
    ] as const)(
      '%s claimed=%s platform/personal=%s target=%s',
      async (action, claimed, platform, targetType) => {
        const { caseId, reportIds, source, target } = await fixture(
          platform,
          targetType,
        );
        const actor = platform ? admin : moderator;
        const before = await db.moderationCase.findUniqueOrThrow({
          where: { id: caseId },
        });
        if (claimed) {
          const claim = await act(caseId, 'claim', actor, platform);
          expect(claim.status).toBe(200);
          expect(claim.body).toMatchObject({
            id: caseId,
            status: 'IN_REVIEW',
            assignedModeratorId: actor,
          });
          expect((await act(caseId, 'claim', actor, platform)).status).toBe(
            409,
          );
        }
        const response = await act(
          caseId,
          action,
          platform ? admin : secondModerator,
          platform,
          { resolutionNote: '  Reviewed evidence  ' },
        );
        const status = action === 'resolve' ? 'RESOLVED' : 'DISMISSED';
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          id: caseId,
          status,
          reportCount: 2,
          uniqueReporterCount: 2,
          resolutionNote: 'Reviewed evidence',
        });
        expect(response.body).not.toHaveProperty('reports');
        const current = await db.moderationCase.findUniqueOrThrow({
          where: { id: caseId },
        });
        expect(current).toMatchObject({
          status,
          assignedModeratorId: claimed ? actor : null,
          reportCount: before.reportCount,
        });
        expect(current.resolvedAt).toBeInstanceOf(Date);
        for (const closedAction of ['claim', 'resolve', 'dismiss'])
          expect(
            (await act(caseId, closedAction, actor, platform)).status,
          ).toBe(409);
        const logs = await db.auditLog.findMany({
          where: { targetId: caseId },
        });
        expect(logs).toHaveLength(claimed ? 2 : 1);
        expect(
          logs.find((log) => log.action === `CASE_${status}`),
        ).toMatchObject({
          targetType: 'MODERATION_CASE',
          targetId: caseId,
          gameId: platform ? null : gameId,
          metadata: {
            caseId,
            targetType,
            targetId: target.id,
            reportCount: 2,
            resolutionNote: 'Reviewed evidence',
          },
        });
        const reports = await db.report.findMany({ where: { caseId } });
        expect(reports.map((row) => row.id).sort()).toEqual(reportIds.sort());
        for (const report of reports)
          for (const field of ['status', 'assignedModeratorId', 'resolvedById'])
            expect(report).not.toHaveProperty(field);
        expect(
          (await db.post.findUniqueOrThrow({ where: { id: source.id } }))
            .status,
        ).toBe('PUBLISHED');
        const newer = await submit(target.id, await user(), targetType);
        expect(newer.status).toBe(201);
        expect(newer.body.caseId).not.toBe(caseId);
        expect((await act(caseId, 'resolve', actor, platform)).status).toBe(
          409,
        );
      },
    );

    it('rejects wrong-game, personal, unauthorized and inactive game access before writes', async () => {
      const { caseId, reportIds } = await fixture();
      const personal = await fixture(true);
      for (const suffix of ['', '/reports', '/claim', '/resolve', '/dismiss']) {
        const method = ['', '/reports'].includes(suffix) ? 'GET' : 'PATCH';
        expect(
          (
            await api(
              `/games/${slug}/moderation/cases/${caseId}${suffix}`,
              author,
              method === 'PATCH' ? {} : undefined,
              method,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await api(
              `/games/${slug}/moderation/cases/${personal.caseId}${suffix}`,
              admin,
              method === 'PATCH' ? {} : undefined,
              method,
            )
          ).status,
        ).toBe(404);
      }
      expect((await act(reportIds[0], 'claim')).status).toBe(404);
      const other = await db.game.create({
        data: { name: 'Wrong scope', slug: `${prefix}-other` },
      });
      try {
        expect(
          (await api(`/games/${other.slug}/moderation/cases/${caseId}`, admin))
            .status,
        ).toBe(404);
        expect(
          (
            await api(
              `/games/${other.slug}/moderation/cases/${caseId}/claim`,
              admin,
              {},
              'PATCH',
            )
          ).status,
        ).toBe(404);
      } finally {
        await db.game.delete({ where: { id: other.id } });
      }
      const inactive = await user();
      await db.gameModerator.create({ data: { gameId, userId: inactive } });
      await db.user.update({
        where: { id: inactive },
        data: { status: 'SUSPENDED' },
      });
      expect((await act(caseId, 'claim', inactive)).status).toBe(403);
      expect(await db.auditLog.count({ where: { targetId: caseId } })).toBe(0);
    });

    it.each(['claim', 'resolve', 'dismiss'])(
      'rolls back %s and audit together on append failure',
      async (action) => {
        const { caseId } = await fixture(true);
        const before = await db.moderationCase.findUniqueOrThrow({
          where: { id: caseId },
        });
        const hook = jest
          .spyOn(app.get(AuditLogRepository), 'create')
          .mockRejectedValueOnce(new Error('Injected case audit failure'));
        try {
          expect((await act(caseId, action, admin, true)).status).toBe(500);
        } finally {
          hook.mockRestore();
        }
        expect(
          await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } }),
        ).toEqual(before);
        expect(await db.auditLog.count({ where: { targetId: caseId } })).toBe(
          0,
        );
      },
    );

    it.each([
      ['claim', 'claim'],
      ['resolve', 'dismiss'],
    ] as const)(
      'arbitrates concurrent %s/%s with one case update/audit',
      async (left, right) => {
        const { caseId } = await fixture(true);
        const responses = await Promise.all([
          act(caseId, left, admin, true),
          act(caseId, right, admin, true),
        ]);
        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        const winner = responses.find((r) => r.status === 200)!;
        expect(
          (await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } }))
            .status,
        ).toBe(winner.body.status);
        expect(
          await db.auditLog.count({
            where: { targetId: caseId, targetType: 'MODERATION_CASE' },
          }),
        ).toBe(1);
        expect(await db.report.count({ where: { caseId } })).toBe(2);
      },
    );

    it('rechecks game scope atomically when Game deletion wins before the conditional update', async () => {
      const { caseId } = await fixture();
      const temporary = await db.game.create({
        data: { name: 'Race game', slug: `${prefix}-scope-race` },
      });
      await db.moderationCase.update({
        where: { id: caseId },
        data: { gameId: temporary.id },
      });
      let deleted = false;
      const hook = intercept(
        (tx) =>
          new Proxy(tx, {
            get(target, key): unknown {
              if (key !== 'moderationCase') return Reflect.get(target, key);
              return new Proxy(tx.moderationCase, {
                get(owner, method): unknown {
                  if (method !== 'updateMany')
                    return Reflect.get(owner, method);
                  return async (args: Prisma.ModerationCaseUpdateManyArgs) => {
                    if (!deleted) {
                      deleted = true;
                      await db.game.delete({ where: { id: temporary.id } });
                    }
                    return owner.updateMany(args);
                  };
                },
              });
            },
          }),
      );
      try {
        expect(
          (
            await api(
              `/games/${temporary.slug}/moderation/cases/${caseId}/claim`,
              admin,
              {},
              'PATCH',
            )
          ).status,
        ).toBe(409);
      } finally {
        hook.mockRestore();
        await db.game.deleteMany({ where: { id: temporary.id } });
      }
      expect(
        (await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } }))
          .status,
      ).toBe('OPEN');
      expect(await db.auditLog.count({ where: { targetId: caseId } })).toBe(0);
    });
  });

  it('new complaints feed native game/platform queues and complaint dashboard metrics', async () => {
    const personal = await post();
    const community = await post(true);
    const a = await submit(personal.id, await user());
    const b = await submit(community.id, await user());
    expect([a.status, b.status]).toEqual([201, 201]);
    const listing = await api('/moderation/cases?limit=100', admin);
    expect(listing.status).toBe(200);
    expect(listing.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: a.body.caseId,
          gameId: null,
          game: null,
        }),
        expect.objectContaining({ id: b.body.caseId, gameId }),
      ]),
    );
    expect(
      listing.body.items.every((row: object) => !('targetSnapshot' in row)),
    ).toBe(true);
    const scoped = await api(
      `/games/${slug}/moderation/cases?limit=100`,
      moderator,
    );
    expect(scoped.status).toBe(200);
    expect(
      scoped.body.items.some((row: { id: string }) => row.id === a.body.caseId),
    ).toBe(false);
    expect(scoped.body.items).toContainEqual(
      expect.objectContaining({ id: b.body.caseId }),
    );
    const content = await api('/admin/content?limit=100', admin);
    expect(content.status).toBe(200);
    expect(content.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: personal.id, gameSlug: null }),
        expect.objectContaining({ id: community.id, gameSlug: slug }),
      ]),
    );
    const overview = await api('/admin/overview', admin);
    expect(overview.status).toBe(200);
    expect(
      overview.body.metrics.find((row: { id: string }) => row.id === 'reports')!
        .value,
    ).toBe(
      await db.report.count({
        where: { case: { status: { in: ['OPEN', 'IN_REVIEW'] } } },
      }),
    );
    for (const [action, status] of [
      ['claim', 200],
      ['resolve', 200],
      ['dismiss', 409],
    ] as const)
      expect(
        (
          await api(
            `/games/${slug}/moderation/cases/${b.body.caseId}/${action}`,
            moderator,
            {},
            'PATCH',
          )
        ).status,
      ).toBe(status);
    expect(
      (
        await api(
          `/games/${slug}/moderation/cases/${a.body.caseId}/claim`,
          admin,
          {},
          'PATCH',
        )
      ).status,
    ).toBe(404);
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: {
            in: [
              personal.id,
              community.id,
              a.body.id,
              b.body.id,
              a.body.caseId,
              b.body.caseId,
            ],
          },
        },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { targetId: { in: [a.body.caseId, b.body.caseId] } },
      }),
    ).toBe(2);
  });
  it('removes obsolete report-centric moderation routes', async () => {
    for (const path of [
      '/moderation/reports',
      '/admin/reports',
      `/games/${slug}/reports`,
    ])
      expect((await api(path, admin)).status).toBe(404);
    expect(
      (await api(`/games/${slug}/reports/old-report/claim`, admin, {}, 'PATCH'))
        .status,
    ).toBe(404);
  });
  describe('native moderation case read API', () => {
    let platformModerator: string;
    let inactiveModerator: string;
    let gameA: { id: string; slug: string };
    let gameB: { id: string; slug: string };
    let targetA: string;
    let targetB: string;
    let personalTarget: string;
    let personalReporter: string;
    let caseA: string;
    let caseB: string;
    let personalCase: string;
    let previousTotal: number;
    const fixtureCases: string[] = [];
    beforeAll(async () => {
      previousTotal = await db.moderationCase.count();
      platformModerator = await user();
      inactiveModerator = await user();
      await db.user.update({
        where: { id: platformModerator },
        data: { role: 'PLATFORM_MODERATOR' },
      });
      await db.user.update({
        where: { id: inactiveModerator },
        data: { role: 'PLATFORM_MODERATOR', status: 'SUSPENDED' },
      });
      gameA = await db.game.create({
        data: { name: 'Native case A', slug: `${prefix}-native-a` },
        select: { id: true, slug: true },
      });
      gameB = await db.game.create({
        data: { name: 'Native case B', slug: `${prefix}-native-b` },
        select: { id: true, slug: true },
      });
      await db.gameModerator.create({
        data: { gameId: gameA.id, userId: moderator },
      });
      targetA = (
        await post(false, { gameId: gameA.id, type: 'GUIDE', title: 'Case A' })
      ).id;
      targetB = (
        await post(false, { gameId: gameB.id, type: 'GUIDE', title: 'Case B' })
      ).id;
      personalTarget = (await post()).id;
      for (const [targetId, count] of [
        [targetA, 3],
        [targetB, 1],
        [personalTarget, 2],
      ] as const) {
        let caseId = '';
        for (let index = 0; index < count; index++) {
          const reporter = await user();
          if (targetId === personalTarget && index === 0)
            personalReporter = reporter;
          const response = await submit(targetId, reporter);
          expect(response.status).toBe(201);
          caseId = response.body.caseId;
        }
        fixtureCases.push(caseId);
      }
      [caseA, caseB, personalCase] = fixtureCases;
    });
    afterAll(async () => {
      await db.game.deleteMany({
        where: { slug: { in: [`${prefix}-native-a`, `${prefix}-native-b`] } },
      });
    });
    const queue = '/moderation/cases';
    it('returns three case rows for six complaints, with native statuses and exact scope filters', async () => {
      const all = await api(`${queue}?limit=100`, platformModerator);
      expect(all.status).toBe(200);
      expect(all.body.meta.total).toBe(previousTotal + 3);
      const ours = all.body.items.filter((row) =>
        fixtureCases.includes(row.id),
      );
      expect(ours).toHaveLength(3);
      expect(ours.find((row) => row.id === caseA)).toMatchObject({
        status: 'OPEN',
        reportCount: 3,
        uniqueReporterCount: 3,
      });
      for (const row of ours)
        for (const field of [
          'reports',
          'targetSnapshot',
          'snapshot',
          'target',
          'resolutionNote',
          'evidence',
        ])
          expect(row).not.toHaveProperty(field);
      const personal = await api(
        `${queue}?scope=platform&limit=100`,
        platformModerator,
      );
      expect(personal.status).toBe(200);
      expect(personal.body.items.map((row) => row.id)).toContain(personalCase);
      expect(personal.body.items.every((row) => row.gameId === null)).toBe(
        true,
      );
      for (const [game, expected] of [
        [gameA, caseA],
        [gameB, caseB],
      ] as const) {
        const result = await api(
          `${queue}?scope=game&gameSlug=${game.slug}&status=OPEN&targetType=POST`,
          platformModerator,
        );
        expect(result.status).toBe(200);
        expect(result.body.meta.total).toBe(1);
        expect(result.body.items.map((row) => row.id)).toEqual([expected]);
      }
      const evidence = await api(
        `${queue}/${caseA}/reports`,
        platformModerator,
      );
      expect(evidence.status).toBe(200);
      expect(evidence.body.items).toHaveLength(3);
      for (const row of evidence.body.items) {
        expect(row).not.toHaveProperty('status');
        expect(row).not.toHaveProperty('targetSnapshot');
      }
    });
    it('serves assigned-game case reads and platform case mutations with live capability', async () => {
      const gameRoot = `/games/${gameA.slug}/moderation/cases`;
      const list = await api(gameRoot, moderator);
      expect(list.status).toBe(200);
      expect(list.body.items.map((row) => row.id)).toEqual([caseA]);
      expect((await api(`${gameRoot}/${caseA}`, moderator)).status).toBe(200);
      const evidence = await api(
        `${gameRoot}/${caseA}/reports?limit=1`,
        moderator,
      );
      expect(evidence.status).toBe(200);
      expect(evidence.body.items).toHaveLength(1);
      expect(evidence.body.nextCursor).not.toBeNull();
      expect(
        (await api(`/games/${gameB.slug}/moderation/cases`, moderator)).status,
      ).toBe(403);
      for (const action of ['claim', 'resolve', 'dismiss']) {
        for (const denied of [author, moderator, inactiveModerator])
          expect(
            (
              await api(
                `${queue}/missing-${prefix}/${action}`,
                denied,
                {},
                'PATCH',
              )
            ).status,
          ).toBe(403);
      }
      expect(
        (await api(`${queue}/${caseB}/claim`, platformModerator, {}, 'PATCH'))
          .status,
      ).toBe(200);
      expect(
        (
          await api(
            `${queue}/${caseB}/dismiss`,
            platformModerator,
            { resolutionNote: ' Reviewed ' },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      expect(
        (await api(`${queue}/${caseB}/resolve`, platformModerator, {}, 'PATCH'))
          .status,
      ).toBe(409);
      expect(
        await db.auditLog.count({
          where: { targetId: caseB, targetType: 'MODERATION_CASE' },
        }),
      ).toBe(2);
      expect(
        (
          await api(
            `${queue}/missing-${prefix}/claim`,
            platformModerator,
            {},
            'PATCH',
          )
        ).status,
      ).toBe(404);
    });
    it('enforces live roles before case existence lookups on every native route', async () => {
      for (const path of [
        queue,
        `${queue}/${caseA}`,
        `${queue}/${caseA}/reports`,
      ]) {
        expect((await api(path, admin)).status).toBe(200);
        expect((await api(path, platformModerator)).status).toBe(200);
        for (const denied of [author, moderator, inactiveModerator])
          expect((await api(path, denied)).status).toBe(403);
        expect((await api(path, null)).status).toBe(401);
      }
      expect(
        (await api(`${queue}/missing-${prefix}`, platformModerator)).status,
      ).toBe(404);
      expect(
        (await api(`${queue}/missing-${prefix}/reports`, platformModerator))
          .status,
      ).toBe(404);
      expect((await api(`${queue}/missing-${prefix}`, moderator)).status).toBe(
        403,
      );
      expect(
        (
          await api(
            `${queue}?scope=game&gameSlug=missing-${prefix}`,
            platformModerator,
          )
        ).status,
      ).toBe(404);
      for (const query of [
        'scope=platform&gameSlug=x',
        'scope=all&gameSlug=x',
        'scope=game',
        'status=PENDING',
        'scope=invalid',
        'limit=101',
      ])
        expect((await api(`${queue}?${query}`, platformModerator)).status).toBe(
          400,
        );
      expect(
        (await api(`${queue}/${caseA}/reports?cursor=bad!`, platformModerator))
          .status,
      ).toBe(400);
    }, 180_000);
    it('separates current target from allowlisted evidence and paginates equal timestamps without duplicates', async () => {
      await db.post.update({
        where: { id: targetA },
        data: { content: 'Changed current target' },
      });
      await db.report.updateMany({
        where: { caseId: caseA },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      const detail = await api(`${queue}/${caseA}`, platformModerator);
      expect(detail.status).toBe(200);
      expect(detail.body.target).toMatchObject({
        content: 'Changed current target',
        targetType: 'POST',
      });
      expect(detail.body.evidence.items).toHaveLength(3);
      expect(
        detail.body.evidence.items.every(
          (row) => row.snapshot?.content === 'Original evidence',
        ),
      ).toBe(true);
      for (const row of detail.body.evidence.items) {
        expect(row).not.toHaveProperty('targetSnapshot');
        expect(row.snapshot).not.toHaveProperty('mediaUploadId');
      }
      const expectedIds = detail.body.evidence.items.map((row) => row.id);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await api(
          `${queue}/${caseA}/reports?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          platformModerator,
        );
        expect(page.status).toBe(200);
        expect(page.body.items).toHaveLength(1);
        ids.push(page.body.items[0].id);
        cursor = page.body.nextCursor;
        expect(ids.length).toBeLessThanOrEqual(3);
      } while (cursor);
      expect(ids).toEqual(expectedIds);
      expect(new Set(ids).size).toBe(3);
    });
    it('keeps stored aggregates after reporter deletion and survives missing target content', async () => {
      await db.user.delete({ where: { id: personalReporter } });
      const detail = await api(`${queue}/${personalCase}`, platformModerator);
      expect(detail.status).toBe(200);
      expect(detail.body.reportCount).toBe(2);
      expect(detail.body.uniqueReporterCount).toBe(2);
      expect(detail.body.evidence.items).toHaveLength(1);
      await db.post.delete({ where: { id: personalTarget } });
      const missing = await api(`${queue}/${personalCase}`, platformModerator);
      expect(missing.status).toBe(200);
      expect(missing.body.target).toBeNull();
      expect(missing.body.targetState).toBe('missing');
      expect(missing.body.evidence.items[0].snapshot?.content).toBe(
        'Original evidence',
      );
    });
    it('reads comment cases and reports soft-deleted targets explicitly', async () => {
      const target = await comment(targetB);
      const response = await submit(target.id, await user(), 'COMMENT');
      expect(response.status).toBe(201);
      const detail = await api(
        `${queue}/${response.body.caseId}`,
        platformModerator,
      );
      expect(detail.status).toBe(200);
      expect(detail.body.target).toMatchObject({
        targetType: 'COMMENT',
        content: 'Comment evidence',
      });
      await db.comment.update({
        where: { id: target.id },
        data: { deletedAt: new Date() },
      });
      const deleted = await api(
        `${queue}/${response.body.caseId}`,
        platformModerator,
      );
      expect(deleted.status).toBe(200);
      expect(deleted.body.targetState).toBe('deleted');
    });
  });
});
