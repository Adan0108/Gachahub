import { ModerationAnalysisScheduler } from '../src/moderation-analysis/moderation-analysis-scheduler.service';
import { isolatedCaseDatabase } from './support/isolated-case-database';
jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    OptionalAuth: () => common.SetMetadata('OPTIONAL', true),
    Session: () =>
      common.createParamDecorator(
        (_data: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest().session,
      )(),
  };
});
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PostsController } from '../src/posts/posts.controller';
import { PostsService } from '../src/posts/posts.service';
import { PostsRepository } from '../src/posts/posts.repository';
import { PostModerationController } from '../src/posts/moderation/post-moderation.controller';
import { AdminPostModerationController } from '../src/posts/moderation/admin-post-moderation.controller';
import { PostModerationService } from '../src/posts/moderation/post-moderation.service';
import { CommentsController } from '../src/comments/comments.controller';
import { CommentsService } from '../src/comments/comments.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentModerationController } from '../src/comments/comment-moderation.controller';
import { AdminCommentModerationController } from '../src/comments/admin-comment-moderation.controller';
import { CommentModerationService } from '../src/comments/comment-moderation.service';
import {
  FeedController,
  GameFeedController,
} from '../src/feed/feed.controller';
import { FeedService } from '../src/feed/feed.service';
import { FeedRepository } from '../src/feed/feed.repository';
import { FeedRankerService } from '../src/feed/feed-ranker.service';
import { TrendingSnapshotService } from '../src/feed/trending/trending-snapshot.service';
import { ForYouSnapshotService } from '../src/feed/for-you/for-you-snapshot.service';
import { FollowsService } from '../src/follows/follows.service';
import { PostVisibilityService } from '../src/post-visibility/post-visibility.service';
import { UserInterestService } from '../src/recommendation/user-interest.service';
import { UserInterestRepository } from '../src/recommendation/user-interest.repository';
import { GameModeratorsService } from '../src/game-moderators/game-moderators.service';
import { GameModeratorsRepository } from '../src/game-moderators/game-moderators.repository';
import { MediaService } from '../src/media/media.service';
import { MentionsService } from '../src/mentions/mentions.service';
import { EventPublisherPort } from '../src/domain-events/event-publisher.port';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import { AuditLogRepository } from '../src/audit-log/audit-log.repository';
import { DiscordLoggerService } from '../src/common/discord/discord-logger.service';
import { PostSaveController } from '../src/posts/save/post-save.controller';
import { PostSaveService } from '../src/posts/save/post-save.service';
import { PostSaveRepository } from '../src/posts/save/post-save.repository';
import { AdminContentController } from '../src/content-moderation/admin-content.controller';
import { ContentModerationService } from '../src/content-moderation/content-moderation.service';
import { ReportsRepository } from '../src/reports/reports.repository';

// Real HTTP controllers, validation, services and PostgreSQL persistence.
// Session injection is test-only; this suite does not test Better Auth login.
// External media/events/mentions/Redis are isolated from the development services.
describe('Personal posts API (development database)', () => {
  jest.setTimeout(90_000);
  let app: INestApplication;
  let db: PrismaService;
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  const token = randomUUID();
  const author = `personal-api-author-${token}`;
  const admin = `personal-api-admin-${token}`;
  const moderator = `personal-api-mod-${token}`;
  const slug = `personal-api-${token}`;
  let gameId: string;
  let personalId: string;
  let communityId: string;
  let commentId: string;
  let categoryId: string;
  const caseIds: string[] = [];

  beforeAll(async () => {
    isolated = await isolatedCaseDatabase();
    const module = await Test.createTestingModule({
      controllers: [
        PostSaveController,
        PostsController,
        PostModerationController,
        AdminPostModerationController,
        CommentsController,
        CommentModerationController,
        AdminCommentModerationController,
        FeedController,
        GameFeedController,
        AdminContentController,
      ],
      providers: [
        { provide: PrismaService, useValue: isolated.prisma },
        PostsService,
        PostsRepository,
        PostModerationService,
        CommentsService,
        CommentsRepository,
        CommentModerationService,
        FeedService,
        FeedRepository,
        FeedRankerService,
        PostVisibilityService,
        UserInterestService,
        UserInterestRepository,
        GameModeratorsService,
        GameModeratorsRepository,
        AuditLogService,
        AuditLogRepository,
        PostSaveService,
        PostSaveRepository,
        ReportsRepository,
        ModerationAnalysisScheduler,
        ContentModerationService,
        {
          provide: FollowsService,
          useValue: {
            isFollowing: async () => ({ following: false }),
            getFollowingIdsAmong: async () => new Set(),
          },
        },
        {
          provide: MediaService,
          useValue: { resolveAttachableMedia: async () => [] },
        },
        {
          provide: MentionsService,
          useValue: {
            resolveTargets: async () => [],
            publishMentions: async () => {},
            findMentionedUsernames: async () => new Map(),
          },
        },
        { provide: EventPublisherPort, useValue: { publish: async () => {} } },
        {
          provide: DiscordLoggerService,
          useValue: { sendError: async () => {} },
        },
        { provide: TrendingSnapshotService, useValue: {} },
        { provide: ForYouSnapshotService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      const id = req.headers['x-test-user'] ?? author;
      req.user = { id };
      req.session = { user: { id } };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    // Keep one server for the suite instead of repeatedly opening/closing
    // Supertest's ephemeral server while Node's HTTP agent reuses sockets.
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    await db.user.createMany({
      data: [
        { id: author, name: 'API Author', email: `${author}@example.invalid` },
        {
          id: moderator,
          name: 'API Moderator',
          email: `${moderator}@example.invalid`,
        },
        {
          id: admin,
          name: 'API Admin',
          email: `${admin}@example.invalid`,
          role: 'ADMIN',
        },
      ],
    });
    const game = await db.game.create({
      data: { name: 'Personal API fixture', slug },
    });
    gameId = game.id;
    categoryId = (
      await db.gameCategory.create({
        data: { gameId, name: 'Guides', slug: 'guides' },
      })
    ).id;
    await db.gameModerator.create({ data: { gameId, userId: moderator } });
  });

  afterAll(async () => {
    try {
      if (db) {
        // Only this suite's unique fixtures are removed; never reset the database.
        await db.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
        await db.auditLog.deleteMany({
          where: { actorId: { in: [author, admin, moderator] } },
        });
        await db.user.deleteMany({
          where: { id: { in: [author, admin, moderator] } },
        });
        await db.game.deleteMany({ where: { slug: { startsWith: slug } } });
      }
    } finally {
      try {
        await app?.close();
      } finally {
        await isolated?.cleanup();
      }
    }
  });

  it('POST /posts accepts content-only personal posts', async () => {
    const response = await request(app.getHttpServer())
      .post('/posts')
      .send({ content: `Personal ${token}` })
      .expect(201);
    personalId = response.body.id;
    expect(response.body).toMatchObject({
      gameId: null,
      game: null,
      categoryId: null,
      type: null,
      title: '',
    });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(0);
  });

  it('POST /posts accepts explicit nulls and personal drafts', async () => {
    const response = await request(app.getHttpServer())
      .post('/posts')
      .send({
        gameId: null,
        type: null,
        categoryId: null,
        content: 'Draft',
        status: 'DRAFT',
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/posts/${response.body.id}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(0);
  });

  it.each([{ type: 'GUIDE' }, { categoryId: 'not-allowed' }])(
    'POST /posts rejects personal classification %j',
    async (extra) => {
      await request(app.getHttpServer())
        .post('/posts')
        .send({ content: 'Invalid', gameId: null, ...extra })
        .expect(400);
    },
  );

  it('POST /posts preserves community classification and counters', async () => {
    const response = await request(app.getHttpServer())
      .post('/posts')
      .send({
        gameId,
        categoryId,
        title: 'Community guide',
        content: `Community ${token}`,
        type: 'GUIDE',
      })
      .expect(201);
    communityId = response.body.id;
    expect(response.body).toMatchObject({ gameId, type: 'GUIDE', categoryId });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(1);
  });

  it('GET detail, profile, search, global and game feeds handle personal posts', async () => {
    const read = async (path: string) => {
      try {
        // Native HTTP client avoids Superagent's observed double-callback
        // failure in multi-suite runs; this still exercises the real API.
        const response = await fetch(`${await app.getUrl()}${path}`);
        expect(response.status).toBe(200);
        return { body: await response.json() };
      } catch (error) {
        throw new Error(`GET ${path} failed`, { cause: error });
      }
    };
    expect((await read(`/posts/${personalId}`)).body.game).toBeNull();
    for (const path of [
      '/posts/mine',
      `/posts?search=${token}`,
      '/feed/latest?limit=100',
    ]) {
      const response = await read(path);
      expect(response.body.items.map((p: any) => p.id)).toContain(personalId);
    }
    const gameFeed = await read(`/games/${slug}/feed`);
    expect(gameFeed.body.items.map((p: any) => p.id)).toContain(communityId);
    expect(gameFeed.body.items.map((p: any) => p.id)).not.toContain(personalId);
  });

  it('personal edits work while game association and classification are immutable', async () => {
    await request(app.getHttpServer())
      .patch(`/posts/${personalId}`)
      .send({ content: `Edited ${token}` })
      .expect(200);
    for (const change of [{ gameId }, { type: 'GUIDE' }, { categoryId }]) {
      await request(app.getHttpServer())
        .patch(`/posts/${personalId}`)
        .send(change)
        .expect(400);
    }
  });

  it('saves personal posts and permits comments without game/type interest signals', async () => {
    await request(app.getHttpServer())
      .post(`/posts/${personalId}/save`)
      .expect(201);
    const saved = await request(app.getHttpServer())
      .get('/posts/saved')
      .expect(200);
    expect(saved.body.items.map((p: any) => p.id)).toContain(personalId);
    const response = await request(app.getHttpServer())
      .post(`/posts/${personalId}/comments`)
      .send({ content: 'Personal comment' })
      .expect(201);
    commentId = response.body.id;
    // Recommendation writes are best-effort in comments; directly await the same
    // service as well to verify its persisted signal set deterministically.
    await app
      .get(UserInterestService)
      .recordPostInteraction(author, personalId, 'COMMENT');
    expect(
      await db.userInterest.count({
        where: { userId: author, entityType: { in: ['GAME', 'POST_TYPE'] } },
      }),
    ).toBe(0);
  });

  it('report helpers and creation preserve null context', async () => {
    const reports = app.get(ReportsRepository);
    expect(await reports.findTargetPostInfo('POST', personalId)).toMatchObject({
      gameId: null,
    });
    expect(
      await reports.findTargetPostInfo('COMMENT', commentId),
    ).toMatchObject({ gameId: null });
    const target = await reports.findTargetPostInfo('POST', personalId);
    const report = await reports.create({
      gameId: null,
      reporterId: author,
      targetType: 'POST',
      targetId: personalId,
      reasonCode: 'OTHER',
      snapshot: target!.snapshot,
    });
    caseIds.push(report.caseId);
    expect(report.caseId).toBeTruthy();
    expect(report).not.toHaveProperty('status');
    expect(
      (await reports.findModerationCaseById(report.caseId))?.gameId,
    ).toBeNull();
    expect(report).not.toHaveProperty('targetSnapshot');
  });

  it('admin content reads expose null game context without fake metadata', async () => {
    for (const [targetType, targetId] of [
      ['POST', personalId],
      ['COMMENT', commentId],
    ] as const) {
      if (targetType === 'POST') continue; // created through the repository above
      const moderationCase = await db.moderationCase.create({
        data: { targetType, targetId, gameId: null },
      });
      caseIds.push(moderationCase.id);
      // Read fixture: report submission is covered separately above.
      await db.report.create({
        data: {
          caseId: moderationCase.id,
          reporterId: author,
          targetType,
          targetId,
          reasonCode: 'OTHER',
        },
      });
    }
    const response = await request(app.getHttpServer())
      .get('/admin/content?limit=100')
      .set('x-test-user', admin)
      .expect(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: personalId,
          gameSlug: null,
          title: `Edited ${token}`,
        }),
        expect.objectContaining({ id: commentId, gameSlug: null }),
      ]),
    );
  });

  it('game moderators cannot act on personal posts/comments or admin routes', async () => {
    for (const path of [
      `/games/${slug}/posts/${personalId}/hide`,
      `/games/${slug}/comments/${commentId}/hide`,
    ]) {
      await request(app.getHttpServer())
        .patch(path)
        .set('x-test-user', moderator)
        .expect(404);
    }
    await request(app.getHttpServer())
      .patch(`/admin/posts/${personalId}/hide`)
      .set('x-test-user', moderator)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/admin/comments/${commentId}/hide`)
      .set('x-test-user', moderator)
      .expect(403);
  });

  it('admins hide/restore personal content with null-game audit entries', async () => {
    for (const [kind, id] of [
      ['posts', personalId],
      ['comments', commentId],
    ]) {
      await request(app.getHttpServer())
        .patch(`/admin/${kind}/${id}/hide`)
        .set('x-test-user', admin)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/admin/${kind}/${id}/restore`)
        .set('x-test-user', admin)
        .expect(200);
    }
    const entries = await db.auditLog.findMany({ where: { actorId: admin } });
    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.gameId === null)).toBe(true);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(1);
  });

  it('Game deletion preserves posts and clears classification', async () => {
    const game = await db.game.create({
      data: { name: 'Delete fixture', slug: `${slug}-delete` },
    });
    const category = await db.gameCategory.create({
      data: { gameId: game.id, name: 'Delete category', slug: 'delete' },
    });
    const post = await db.post.create({
      data: {
        authorId: author,
        gameId: game.id,
        categoryId: category.id,
        title: 'Survives',
        content: 'History',
        type: 'GUIDE',
      },
    });
    await db.game.delete({ where: { id: game.id } });
    expect(
      await db.post.findUniqueOrThrow({ where: { id: post.id } }),
    ).toMatchObject({ gameId: null, categoryId: null, type: null });
  });

  it('DELETE personal post leaves community counters unchanged', async () => {
    await request(app.getHttpServer())
      .delete(`/posts/${personalId}`)
      .expect(200);
    await request(app.getHttpServer()).get(`/posts/${personalId}`).expect(404);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(1);
    await request(app.getHttpServer())
      .delete(`/posts/${communityId}`)
      .expect(200);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount,
    ).toBe(0);
  });
});
