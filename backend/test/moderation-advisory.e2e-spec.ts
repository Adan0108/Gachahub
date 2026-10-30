import 'dotenv/config';
jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    Session: () =>
      common.createParamDecorator(
        (_: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest<{ session: unknown }>().session,
      )(),
  };
});
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Prisma,
  type ModerationAnalysisStatus,
} from '../src/generated/prisma/client';
import { ReportsRepository } from '../src/reports/reports.repository';
import { ReportModerationService } from '../src/reports/moderation/report-moderation.service';
import { PlatformCaseModerationController } from '../src/reports/platform-moderation/platform-case-moderation.controller';
import { GameCaseModerationController } from '../src/reports/game-moderation/game-case-moderation.controller';
import { GameModeratorsService } from '../src/game-moderators/game-moderators.service';
import { GameModeratorsRepository } from '../src/game-moderators/game-moderators.repository';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import { ModerationAnalysisScheduler } from '../src/moderation-analysis/moderation-analysis-scheduler.service';
import { canonicalTextInput } from '../src/moderation-analysis/canonical-text-input';
import { getModerationPolicyClassifierProfile } from '../src/moderation-policy/moderation-policy.profiles';
import type { AiAdvisory } from '../src/reports/domain/ai-advisory';
import { isolatedCaseDatabase } from './support/isolated-case-database';

describe('Stage 2D.4 authorized read-only advisory (real PostgreSQL/HTTP)', () => {
  jest.setTimeout(120000);
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let db: PrismaService;
  let repository: ReportsRepository;
  let app: INestApplication;
  let url: string;
  let game: { id: string; slug: string };
  let other: { id: string; slug: string };
  const actors = {
    admin: randomUUID(),
    platform: randomUUID(),
    moderator: randomUUID(),
    user: randomUUID(),
    suspended: randomUUID(),
  };
  const queries: string[] = [];
  const profile = getModerationPolicyClassifierProfile(
    'toxicity-mmbert-small-v1',
  )!;
  const scheduling = {
    scheduleIfNeeded: jest.fn(() => {
      throw new Error('Read scheduled work');
    }),
  };
  const audit = {
    recordOrThrow: jest.fn(() => {
      throw new Error('Read wrote audit');
    }),
  };

  beforeAll(async () => {
    isolated = await isolatedCaseDatabase((query) => queries.push(query));
    db = isolated.prisma as PrismaService;
    const module = await Test.createTestingModule({
      controllers: [
        PlatformCaseModerationController,
        GameCaseModerationController,
      ],
      providers: [
        { provide: PrismaService, useValue: db },
        ReportsRepository,
        ReportModerationService,
        GameModeratorsService,
        GameModeratorsRepository,
        { provide: ModerationAnalysisScheduler, useValue: scheduling },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(
      (
        req: Request & { user?: { id: string }; session?: unknown },
        _res: Response,
        next: NextFunction,
      ) => {
        const id = req.headers['x-test-user'];
        if (typeof id === 'string') {
          req.user = { id };
          req.session = { user: { id } };
        }
        next();
      },
    );
    app.useGlobalGuards({
      canActivate(context) {
        if (!context.switchToHttp().getRequest<{ session?: unknown }>().session)
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
    url = await app.getUrl();
    repository = app.get(ReportsRepository);
    for (const [name, id] of Object.entries(actors))
      await db.user.create({
        data: {
          id,
          email: `${id}@example.invalid`,
          name,
          role:
            name === 'admin'
              ? 'ADMIN'
              : name === 'platform'
                ? 'PLATFORM_MODERATOR'
                : 'USER',
          status: name === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
        },
      });
    game = await db.game.create({
      data: { name: 'Advisory fixtures', slug: randomUUID() },
    });
    other = await db.game.create({
      data: { name: 'Other fixtures', slug: randomUUID() },
    });
    await db.gameModerator.create({
      data: { gameId: game.id, userId: actors.moderator },
    });
  });
  beforeEach(async () => {
    await db.moderationCase.deleteMany();
    queries.length = 0;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await isolated?.cleanup();
    }
  });

  async function request(path: string, actor: string | null = actors.admin) {
    const response = await fetch(url + path, {
      headers: actor ? { 'x-test-user': actor } : {},
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        id: string;
        aiAdvisory: AiAdvisory;
        items: Array<{ id: string; aiAdvisory: AiAdvisory }>;
        target?: { content: string };
        currentRiskLevel: unknown;
        currentRiskScore: unknown;
      },
    };
  }
  async function fixture(
    kind: 'POST' | 'COMMENT' = 'POST',
    gameId: string | null = game.id,
  ) {
    const post = await db.post.create({
      data: {
        authorId: actors.user,
        gameId,
        type: gameId ? 'GUIDE' : null,
        title: '  Tiêu đề 😀 ',
        content: 'Cảm ơn\r\nBody',
      },
    });
    const comment =
      kind === 'COMMENT'
        ? await db.comment.create({
            data: {
              authorId: actors.user,
              postId: post.id,
              content: 'Comment body',
            },
          })
        : null;
    const item = await db.moderationCase.create({
      data: { targetType: kind, targetId: comment?.id ?? post.id, gameId },
    });
    return { post, comment, item };
  }
  async function analysis(
    f: Awaited<ReturnType<typeof fixture>>,
    generation = 1,
    content = f.comment?.content ?? f.post.content,
    status: ModerationAnalysisStatus = 'SUCCEEDED',
  ) {
    const input = canonicalTextInput(
      f.comment
        ? { targetType: 'COMMENT', content }
        : { targetType: 'POST', title: f.post.title, content },
    );
    return db.moderationAnalysis.create({
      data: {
        ...input,
        caseId: f.item.id,
        generation,
        targetType: f.item.targetType,
        targetId: f.item.targetId,
        classifierProfile: profile.profile,
        status,
        result: {
          output: {
            model: profile.model,
            labels: profile.labels.map((label) => ({
              label,
              score: label === 'threat' ? 0.74 : 0,
            })),
          },
        },
      },
    });
  }
  async function policy(
    analysisId: string,
    policyVersion = 'moderation-policy-v1',
  ) {
    return db.moderationPolicyEvaluation.create({
      data: {
        analysisId,
        policyVersion,
        status: 'SUCCEEDED',
        riskLevel: 'MEDIUM',
        priorityScore: 40,
        signals: ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED'],
        evaluatedAt: new Date(),
      },
    });
  }
  const detailPath = (id: string) => `/moderation/cases/${id}`;

  it.each([actors.admin, actors.platform, actors.moderator])(
    'list/detail share CURRENT for authorized actor %s',
    async (actor) => {
      const f = await fixture();
      const a = await analysis(f);
      await policy(a.id);
      const root =
        actor === actors.moderator
          ? `/games/${game.slug}/moderation/cases`
          : `/moderation/cases?scope=game&gameSlug=${game.slug}`;
      const detail = await request(
        actor === actors.moderator
          ? `/games/${game.slug}/moderation/cases/${f.item.id}`
          : detailPath(f.item.id),
        actor,
      );
      const list = await request(root, actor);
      expect(detail.status).toBe(200);
      expect(list.status).toBe(200);
      expect(detail.body.aiAdvisory).toMatchObject({
        state: 'CURRENT',
        analysisGeneration: 1,
        priorityScore: 40,
      });
      expect(
        list.body.items.find((i) => i.id === f.item.id)?.aiAdvisory,
      ).toEqual(detail.body.aiAdvisory);
      expect(detail.body.currentRiskScore).toBeNull();
      expect(detail.body.currentRiskLevel).toBeNull();
      const raw = JSON.stringify(list.body);
      for (const secret of [
        'rawTitle',
        'rawContent',
        'inputSnapshot',
        'snapshotHash',
        'classifierProfile',
        'leaseToken',
        'attemptCount',
        profile.model.name,
        'Cảm ơn\\r\\nBody',
      ])
        expect(raw).not.toContain(secret);
    },
  );
  it.each([null, actors.user, actors.suspended])(
    'rejects unauthorized actor before advisory lookup: %s',
    async (actor) => {
      const f = await fixture();
      const lookup = jest.spyOn(repository, 'findLatestAdvisoryAnalyses');
      try {
        const result = await request(detailPath(f.item.id), actor);
        expect(result.status).toBe(actor === null ? 401 : 403);
        expect(lookup).not.toHaveBeenCalled();
      } finally {
        lookup.mockRestore();
      }
    },
  );
  it('isolates exact game ownership and denies platform access to game-only moderators', async () => {
    const f = await fixture();
    expect(
      (
        await request(
          `/games/${other.slug}/moderation/cases/${f.item.id}`,
          actors.admin,
        )
      ).status,
    ).toBe(404);
    expect((await request('/moderation/cases', actors.moderator)).status).toBe(
      403,
    );
    expect(
      (await request(`/games/${other.slug}/moderation/cases`, actors.moderator))
        .status,
    ).toBe(403);
    const personal = await fixture('POST', null);
    expect(
      (
        await request(
          `/games/${game.slug}/moderation/cases/${personal.item.id}`,
          actors.moderator,
        )
      ).status,
    ).toBe(404);
  });
  it('Race A: late gen1 completion cannot replace completed gen2', async () => {
    const f = await fixture();
    const first = await analysis(f, 1, 'Older', 'PENDING');
    const second = await analysis(f, 2);
    await policy(second.id);
    await db.moderationAnalysis.update({
      where: { id: first.id },
      data: { status: 'SUCCEEDED' },
    });
    await policy(first.id);
    expect(
      (await request(detailPath(f.item.id))).body.aiAdvisory,
    ).toMatchObject({ state: 'CURRENT', analysisGeneration: 2 });
  });
  it('Race B: target edit before allocation invalidates formerly current evidence', async () => {
    const f = await fixture();
    const a = await analysis(f);
    await policy(a.id);
    await db.post.update({
      where: { id: f.post.id },
      data: { content: 'Changed' },
    });
    expect((await request(detailPath(f.item.id))).body.aiAdvisory).toEqual({
      state: 'CONTENT_CHANGED',
      analysisGeneration: 1,
    });
  });
  it.each([
    ['PENDING', 'ANALYSIS_PENDING'],
    ['FAILED', 'ANALYSIS_FAILED'],
  ] as const)(
    'Race C/D: gen2 %s prevents gen1 fallback',
    async (status, state) => {
      const f = await fixture();
      const first = await analysis(f, 1, 'Older');
      await policy(first.id);
      await analysis(f, 2, f.post.content, status);
      expect((await request(detailPath(f.item.id))).body.aiAdvisory).toEqual({
        state,
        analysisGeneration: 2,
      });
    },
  );
  it('Race E: A→B→A reuse leaves gen2/B selected; gen1/A is never promoted', async () => {
    const f = await fixture();
    const first = await analysis(f);
    await policy(first.id);
    await analysis(f, 2, 'B');
    expect((await request(detailPath(f.item.id))).body.aiAdvisory).toEqual({
      state: 'CONTENT_CHANGED',
      analysisGeneration: 2,
    });
    expect(await db.moderationAnalysis.count()).toBe(2);
  });
  it('only active policy version counts; missing active row stays pending without repair', async () => {
    const f = await fixture();
    const a = await analysis(f);
    await policy(a.id, 'moderation-policy-old');
    expect((await request(detailPath(f.item.id))).body.aiAdvisory).toEqual({
      state: 'POLICY_PENDING',
      analysisGeneration: 1,
    });
    expect(await db.moderationPolicyEvaluation.count()).toBe(1);
  });
  it.each([
    'NO_ANALYSIS',
    'POLICY_PENDING',
    'POLICY_FAILED',
    'UNSUPPORTED_EVIDENCE',
    'FRESHNESS_UNVERIFIED',
  ] as const)('list/detail omit stale output for %s', async (state) => {
    const f = await fixture();
    if (state !== 'NO_ANALYSIS') {
      const a = await analysis(f);
      if (state === 'POLICY_FAILED') {
        const p = await policy(a.id);
        await db.moderationPolicyEvaluation.update({
          where: { id: p.id },
          data: {
            status: 'FAILED',
            riskLevel: null,
            priorityScore: null,
            signals: Prisma.DbNull,
            evaluatedAt: null,
          },
        });
      } else if (state === 'UNSUPPORTED_EVIDENCE') {
        await db.moderationAnalysis.update({
          where: { id: a.id },
          data: { classifierProfile: 'moderation-text-v1' },
        });
      } else if (state === 'FRESHNESS_UNVERIFIED') {
        await db.moderationAnalysis.update({
          where: { id: a.id },
          data: { inputSchemaVersion: 2 },
        });
      }
    }
    const detail = await request(detailPath(f.item.id));
    const list = await request('/moderation/cases');
    expect(detail.status).toBe(200);
    expect(list.status).toBe(200);
    const expected = {
      state,
      ...(state === 'NO_ANALYSIS' ? {} : { analysisGeneration: 1 }),
    };
    expect(detail.body.aiAdvisory).toEqual(expected);
    expect(list.body.items[0].aiAdvisory).toEqual(expected);
  });
  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'history %s has no current scores',
    async (status) => {
      const f = await fixture();
      const a = await analysis(f);
      await policy(a.id);
      await db.moderationCase.update({
        where: { id: f.item.id },
        data: { status },
      });
      expect((await request(detailPath(f.item.id))).body.aiAdvisory.state).toBe(
        'CASE_CLOSED',
      );
      const history = await request('/moderation/cases?view=history');
      expect(history.body.items[0].aiAdvisory.state).toBe('CASE_CLOSED');
      expect(await db.moderationPolicyEvaluation.count()).toBe(1);
    },
  );
  it.each([
    'post-deleted',
    'post-missing',
    'comment-deleted',
    'parent-deleted',
    'hidden',
  ] as const)('moderator target semantics: %s', async (mode) => {
    const f = await fixture(
      mode.startsWith('comment') ||
        mode === 'parent-deleted' ||
        mode === 'hidden'
        ? 'COMMENT'
        : 'POST',
    );
    const a = await analysis(f);
    await policy(a.id);
    if (mode === 'post-deleted' || mode === 'parent-deleted')
      await db.post.update({
        where: { id: f.post.id },
        data: { deletedAt: new Date() },
      });
    if (mode === 'post-missing')
      await db.post.delete({ where: { id: f.post.id } });
    if (mode === 'comment-deleted')
      await db.comment.update({
        where: { id: f.comment!.id },
        data: { deletedAt: new Date() },
      });
    if (mode === 'hidden')
      await db.comment.update({
        where: { id: f.comment!.id },
        data: { status: 'HIDDEN' },
      });
    expect((await request(detailPath(f.item.id))).body.aiAdvisory.state).toBe(
      mode === 'hidden' ? 'CURRENT' : 'TARGET_UNAVAILABLE',
    );
    const list = await request('/moderation/cases');
    expect(list.body.items[0].aiAdvisory.state).toBe(
      mode === 'hidden' ? 'CURRENT' : 'TARGET_UNAVAILABLE',
    );
  });
  it('repeatable read prevents mixing old case and newly edited target', async () => {
    const f = await fixture();
    const a = await analysis(f);
    await policy(a.id);
    const original = repository.findCaseTarget.bind(
      repository,
    ) as typeof repository.findCaseTarget;
    const intercept = jest
      .spyOn(repository, 'findCaseTarget')
      .mockImplementationOnce(async (kind, id, tx) => {
        await db.post.update({
          where: { id: f.post.id },
          data: { content: 'Concurrent edit' },
        });
        return original(kind, id, tx);
      });
    try {
      const response = await request(detailPath(f.item.id));
      expect(response.body.aiAdvisory.state).toBe('CURRENT');
      expect(response.body.target?.content).toBe(f.post.content);
    } finally {
      intercept.mockRestore();
    }
    expect((await request(detailPath(f.item.id))).body.aiAdvisory.state).toBe(
      'CONTENT_CHANGED',
    );
  });
  it('GET SQL is read-only and does not alter work, leases, case or target', async () => {
    const f = await fixture();
    const a = await analysis(f);
    await policy(a.id);
    const before = {
      analysis: await db.moderationAnalysis.findMany(),
      policy: await db.moderationPolicyEvaluation.findMany(),
      item: await db.moderationCase.findMany(),
      post: await db.post.findUnique({ where: { id: f.post.id } }),
      outbox: await db.outboxEvent.count(),
    };
    queries.length = 0;
    await request(detailPath(f.item.id));
    await request('/moderation/cases');
    const readQueries = [...queries];
    expect(readQueries.some((q) => /SET TRANSACTION READ ONLY/i.test(q))).toBe(
      true,
    );
    expect(readQueries.some((q) => /\b(INSERT|UPDATE|DELETE)\b/i.test(q))).toBe(
      false,
    );
    expect(scheduling.scheduleIfNeeded).not.toHaveBeenCalled();
    expect(audit.recordOrThrow).not.toHaveBeenCalled();
    expect({
      analysis: await db.moderationAnalysis.findMany(),
      policy: await db.moderationPolicyEvaluation.findMany(),
      item: await db.moderationCase.findMany(),
      post: await db.post.findUnique({ where: { id: f.post.id } }),
      outbox: await db.outboxEvent.count(),
    }).toEqual(before);
    await expect(
      repository.readSnapshot(
        (tx) => tx.$executeRaw`UPDATE moderation_cases SET status = status`,
      ),
    ).rejects.toThrow();
  });
  it('20/50/100 pages have constant SQL count and use existing latest-generation index', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 100 }, () => fixture()),
    );
    await Promise.all(
      fixtures.map((f) => analysis(f, 1, f.post.content, 'PENDING')),
    );
    const counts: number[] = [];
    for (const limit of [20, 50, 100]) {
      queries.length = 0;
      const started = performance.now();
      const response = await request(`/moderation/cases?limit=${limit}`);
      const responseMs = Math.round(performance.now() - started);
      const statements = [...queries];
      counts.push(statements.length);
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(limit);
      expect(
        response.body.items.every(
          (i) => i.aiAdvisory.state === 'ANALYSIS_PENDING',
        ),
      ).toBe(true);
      let sql: Prisma.Sql | undefined;
      await repository.findLatestAdvisoryAnalyses(
        fixtures.slice(0, limit).map((f) => f.item.id),
        {
          $queryRaw: (query: Prisma.Sql) => {
            sql = query;
            return Promise.resolve([]);
          },
        } as unknown as Prisma.TransactionClient,
      );
      const plan = await db.$queryRaw(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql!}`,
      );
      expect(JSON.stringify(plan)).toContain(
        'moderation_analyses_caseId_generation_key',
      );
      console.info({
        casePageSize: limit,
        sqlStatements: statements.length,
        responseMs,
      });
    }
    expect(new Set(counts).size).toBe(1);
  });
});
