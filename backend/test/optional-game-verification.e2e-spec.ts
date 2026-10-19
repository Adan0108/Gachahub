jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    OptionalAuth: () => common.SetMetadata('OPTIONAL', true),
    AllowAnonymous: () => common.SetMetadata('OPTIONAL', true),
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
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { FollowsRepository } from '../src/follows/follows.repository';
import { MediaRepository } from '../src/media/media.repository';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import { RedisService } from '../src/redis/redis.service';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxEventPublisher } from '../src/outbox/outbox-event.publisher';
import { NotificationController } from '../src/notifications/notification.controller';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { NotificationConsumerService } from '../src/notifications/notification-consumer.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { SocketNotificationDeliveryService } from '../src/notifications/realtime/socket-notification-delivery.service';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { UsersRepository } from '../src/users/users.repository';
import { UserSearchRateLimiterService } from '../src/users/user-search-rate-limiter.service';
import { UsernameAvailabilityRateLimiterService } from '../src/users/username-availability-rate-limiter.service';
import { BlocksService } from '../src/blocks/blocks.service';
import { BlocksRepository } from '../src/blocks/blocks.repository';
import { GamesController } from '../src/games/games.controller';
import { GamesService } from '../src/games/games.service';
import { GamesRepository } from '../src/games/games.repository';
import { AdminOverviewController } from '../src/overview/admin-overview.controller';
import { OverviewService } from '../src/overview/overview.service';
import { AdminAuditLogController } from '../src/audit-log/admin-audit-log.controller';
import { GameAuditLogController } from '../src/audit-log/game-audit-log.controller';
import { AuditLogQueryService } from '../src/audit-log/audit-log-query.service';
import { ReportsController } from '../src/reports/reports.controller';
import { AdminReportsController } from '../src/reports/admin/admin-reports.controller';
import { ReportModerationController } from '../src/reports/game-moderation/report-moderation.controller';
import { ReportsService } from '../src/reports/reports.service';
import { ReportModerationService } from '../src/reports/moderation/report-moderation.service';
import { ReportRateLimiterService } from '../src/reports/infrastructure/report-rate-limiter.service';
import type {
  Prisma,
  PostType,
  PostVisibility,
} from '../src/generated/prisma/client';

// Verification checklist (real persistence unless explicitly noted):
// DTO classification/title/visibility; create/media/tags/mentions; update and
// category/type immutability; all four counter writers; retention and races;
// detail/profile/search/latest/trending/For You; save/like/comment/reply;
// interest deltas/ranking; admin/game permissions/audits; report creation/null
// reads and the restored case moderation transitions.
// Sessions are injected, with a test auth gate matching OPTIONAL metadata.
// Real outbox/mentions/media attachment/notification dispatch; no Kafka broker,
// Cloudinary requests or Socket.IO delivery. Only Redis storage is in memory;
// production snapshot construction, validation and hydration remain real.
describe('Optional-game comprehensive API/integration verification', () => {
  jest.setTimeout(120_000);
  const runId = randomUUID();
  const prefix = `optional-verify-${runId}`;
  const author = `${prefix}-author`;
  const viewer = `${prefix}-viewer`;
  const follower = `${prefix}-follower`;
  const admin = `${prefix}-admin`;
  const moderator = `${prefix}-moderator`;
  const inactive = `${prefix}-inactive`;
  const userIds = [author, viewer, follower, admin, moderator, inactive];
  const mentionHandle = `v${runId.replaceAll('-', '').slice(0, 18)}`;
  let app: INestApplication;
  let db: PrismaService;
  let gameId: string;
  let otherGameId: string;
  let categoryId: string;
  let otherCategoryId: string;
  let inactiveCategoryId: string;
  let inactiveGameId: string;
  const slug = `${prefix}-game`;
  const otherSlug = `${prefix}-other`;
  const caseIds: string[] = [];
  const aggregates = new Set<string>(userIds);
  const signalWrites: Promise<void>[] = [];
  const cache = new Map<string, unknown>();
  const socketDelivery = { publish: jest.fn() };
  let consumer: NotificationConsumerService;

  const http = () => request(app.getHttpServer());
  const counter = async () =>
    (await db.game.findUniqueOrThrow({ where: { id: gameId } })).postCount;
  const persisted = (id: string) =>
    db.post.findUniqueOrThrow({ where: { id } });
  async function create(body: Record<string, unknown> = {}, as = author) {
    const response = await http()
      .post('/posts')
      .set('x-test-user', as)
      .send({ content: `Story ${runId}`, ...body })
      .expect(201);
    aggregates.add(response.body.id);
    return response.body;
  }
  async function community(body: Record<string, unknown> = {}) {
    return create({ gameId, title: 'Community fixture', ...body });
  }
  async function uploaded(
    resourceType: 'IMAGE' | 'VIDEO' = 'IMAGE',
    owner = author,
  ) {
    return db.mediaUpload.create({
      data: {
        userId: owner,
        purpose: 'POST',
        resourceType,
        status: 'UPLOADED',
        assetId: `${prefix}-${randomUUID()}`,
        publicId: `${prefix}/${randomUUID()}`,
        secureUrl: 'https://media.example.invalid/fixture',
        format: resourceType === 'IMAGE' ? 'png' : 'mp4',
        bytes: 256,
      },
    });
  }
  async function flushSignals() {
    await Promise.all(signalWrites.splice(0));
  }
  async function dispatchEvents(ids: string[]) {
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    });
    for (const event of events) {
      await consumer['handleEvent']({
        eventId: event.id,
        type: event.type as never,
        version: event.version,
        occurredAt: event.occurredAt.toISOString(),
        aggregateId: event.aggregateId,
        payload: event.payload,
      });
    }
    return events;
  }

  beforeAll(async () => {
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
        NotificationController,
        UsersController,
        GamesController,
        AdminOverviewController,
        AdminAuditLogController,
        GameAuditLogController,
        ReportsController,
        AdminReportsController,
        ReportModerationController,
      ],
      providers: [
        PrismaService,
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
        ContentModerationService,
        FollowsService,
        FollowsRepository,
        MediaService,
        MediaRepository,
        MentionsService,
        OutboxRepository,
        OutboxEventPublisher,
        NotificationService,
        NotificationRepository,
        ProcessedEventRepository,
        ReportsService,
        ReportModerationService,
        ReportRateLimiterService,
        TrendingSnapshotService,
        ForYouSnapshotService,
        { provide: EventPublisherPort, useExisting: OutboxEventPublisher },
        UsersService,
        UsersRepository,
        UserSearchRateLimiterService,
        UsernameAvailabilityRateLimiterService,
        BlocksService,
        BlocksRepository,
        GamesService,
        GamesRepository,
        OverviewService,
        AuditLogQueryService,
        {
          provide: CloudinaryService,
          useValue: {
            deleteAsset: () => {
              throw new Error('Unexpected external Cloudinary request');
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: async (key: string) => cache.get(key) ?? null,
            set: async (key: string, value: unknown) => {
              cache.set(key, value);
            },
            getJson: async (key: string) => cache.get(key) ?? null,
            setJson: async (key: string, value: unknown) => {
              cache.set(key, value);
            },
            delete: async (key: string) => {
              cache.delete(key);
            },
          },
        },
        {
          provide: DiscordLoggerService,
          useValue: { sendError: async () => {} },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      const id =
        req.headers['x-test-user'] === 'anonymous'
          ? null
          : (req.headers['x-test-user'] ?? author);
      req.user = id ? { id } : null;
      req.session = id ? { user: { id } } : null;
      next();
    });
    const reflector = new Reflector();
    app.useGlobalGuards({
      canActivate: (ctx: ExecutionContext) => {
        if (
          reflector.getAllAndOverride('OPTIONAL', [
            ctx.getHandler(),
            ctx.getClass(),
          ])
        )
          return true;
        if (!ctx.switchToHttp().getRequest().session)
          throw new UnauthorizedException('Authentication required');
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
    db = app.get(PrismaService);
    await db.user.createMany({
      data: userIds.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        ...(id === viewer ? { username: mentionHandle } : {}),
        ...(id === admin ? { role: 'ADMIN' as const } : {}),
        ...(id === inactive ? { status: 'SUSPENDED' as const } : {}),
      })),
    });
    gameId = (
      await db.game.create({ data: { name: 'Verification game', slug } })
    ).id;
    otherGameId = (
      await db.game.create({ data: { name: 'Other game', slug: otherSlug } })
    ).id;
    inactiveGameId = (
      await db.game.create({
        data: {
          name: 'Archived game',
          slug: `${prefix}-archived`,
          status: 'ARCHIVED',
        },
      })
    ).id;
    categoryId = (
      await db.gameCategory.create({
        data: { gameId, name: 'Guides', slug: 'guides' },
      })
    ).id;
    inactiveCategoryId = (
      await db.gameCategory.create({
        data: { gameId, name: 'Inactive', slug: 'inactive', isActive: false },
      })
    ).id;
    otherCategoryId = (
      await db.gameCategory.create({
        data: { gameId: otherGameId, name: 'Other', slug: 'other' },
      })
    ).id;
    await db.gameModerator.create({ data: { gameId, userId: moderator } });
    await db.userFollow.create({
      data: { followerId: follower, followingId: author },
    });
    const interests = app.get(UserInterestService);
    const record = interests.recordPostInteraction.bind(interests);
    jest
      .spyOn(interests, 'recordPostInteraction')
      .mockImplementation((...args) => {
        const pending = record(...args);
        signalWrites.push(pending);
        return pending;
      });
    // Exercise the real consumer's event transaction/dispatch without starting
    // Kafka. It is intentionally not a Nest lifecycle provider in this harness.
    consumer = new NotificationConsumerService(
      app.get(NotificationService),
      app.get(ProcessedEventRepository),
      db,
      socketDelivery as unknown as SocketNotificationDeliveryService,
    );
  });

  afterEach(async () => {
    await flushSignals();
    cache.clear();
  });
  afterAll(async () => {
    try {
      if (db) {
        await flushSignals();
        const posts = await db.post.findMany({
          where: { authorId: { in: userIds } },
          select: { id: true },
        });
        const comments = await db.comment.findMany({
          where: { authorId: { in: userIds } },
          select: { id: true },
        });
        [...posts, ...comments].forEach((row) => aggregates.add(row.id));
        const events = await db.outboxEvent.findMany({
          where: { aggregateId: { in: [...aggregates] } },
          select: { id: true },
        });
        await db.processedEvent.deleteMany({
          where: { eventId: { in: events.map((e) => e.id) } },
        });
        await db.outboxEvent.deleteMany({
          where: { aggregateId: { in: [...aggregates] } },
        });
        await db.mention.deleteMany({
          where: { entityId: { in: [...aggregates] } },
        });
        await db.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
        await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
        await db.post.deleteMany({ where: { authorId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
        await db.game.deleteMany({ where: { slug: { startsWith: prefix } } });
        await db.tag.deleteMany({ where: { slug: { startsWith: prefix } } });
      }
    } finally {
      await app?.close();
    }
  });

  describe('creation contracts and persistence', () => {
    it.each([
      {},
      { gameId: null },
      { gameId: null, type: null, categoryId: null },
      { status: 'DRAFT' },
    ])(
      'creates personal posts with %j without Game lookup/counters',
      async (body) => {
        const before = await counter();
        const lookup = jest.spyOn(app.get(PostsRepository), 'findGameById');
        try {
          const post = await create(body);
          expect(await persisted(post.id)).toMatchObject({
            gameId: null,
            type: null,
            categoryId: null,
          });
          expect(lookup).not.toHaveBeenCalled();
          expect(await counter()).toBe(before);
        } finally {
          lookup.mockRestore();
        }
      },
    );

    it.each([undefined, null])(
      'rejects personal classification for gameId=%s',
      async (game) => {
        for (const classification of [{ type: 'GUIDE' }, { categoryId }]) {
          const response = await http()
            .post('/posts')
            .send({
              content: 'Invalid combination',
              ...(game === undefined ? {} : { gameId: game }),
              ...classification,
            })
            .expect(400);
          expect(response.body.message).toMatch(/Personal posts cannot/);
        }
      },
    );

    it.each([
      { gameId: 17 },
      { gameId: '' },
      { gameId: {} },
      { gameId: [] },
      { type: 'INVALID' },
      { type: 17 },
      { categoryId: 17 },
      { visibility: 'INVALID' },
      { status: 'HIDDEN' },
      { content: '' },
      { title: 'a' },
    ])('rejects invalid DTO data %j with 400', async (extra) => {
      await http()
        .post('/posts')
        .send({ content: 'Invalid fixture', ...extra })
        .expect(400);
    });

    it.each(['PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE'] as PostVisibility[])(
      'persists personal tags, media and %s visibility',
      async (visibility) => {
        const upload = await uploaded();
        const tag = `${prefix}-tag-${visibility.toLowerCase().replaceAll('_', '-')}`;
        const post = await create({
          visibility,
          tags: [tag, tag],
          media: [{ mediaUploadId: upload.id, altText: 'Fixture image' }],
        });
        expect(await persisted(post.id)).toMatchObject({
          gameId: null,
          type: null,
          categoryId: null,
          visibility,
        });
        expect(post.tags.map((t: { slug: string }) => t.slug)).toEqual([tag]);
        expect(
          await db.postMedia.findUnique({
            where: { mediaUploadId: upload.id },
          }),
        ).toMatchObject({ postId: post.id, altText: 'Fixture image' });
        expect(
          await db.mediaUpload.findUnique({ where: { id: upload.id } }),
        ).toMatchObject({ status: 'ATTACHED' });
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', author)
          .expect(200);
      },
    );

    it('rejects foreign, unconfirmed, duplicate and mixed media without creating a post', async () => {
      const foreign = await uploaded('IMAGE', viewer);
      const image = await uploaded();
      const video = await uploaded('VIDEO');
      const pending = await uploaded();
      await db.mediaUpload.update({
        where: { id: pending.id },
        data: { status: 'INITIATED' },
      });
      const count = await db.post.count({ where: { authorId: author } });
      for (const [ids, status] of [
        [[foreign.id], 403],
        [[pending.id], 400],
        [[image.id, image.id], 400],
        [[image.id, video.id], 400],
      ] as const) {
        await http()
          .post('/posts')
          .send({
            content: 'Invalid media',
            media: ids.map((mediaUploadId) => ({ mediaUploadId })),
          })
          .expect(status);
      }
      expect(await db.post.count({ where: { authorId: author } })).toBe(count);
      expect(
        (await db.mediaUpload.findUniqueOrThrow({ where: { id: image.id } }))
          .status,
      ).toBe('UPLOADED');
    });

    it.each([false, true])(
      'preserves community defaults and category optionality: category=%s',
      async (withCategory) => {
        const before = await counter();
        const post = await community(withCategory ? { categoryId } : {});
        expect(await persisted(post.id)).toMatchObject({
          gameId,
          type: 'GENERAL',
          categoryId: withCategory ? categoryId : null,
        });
        expect(await counter()).toBe(before + 1);
      },
    );

    it('preserves explicit community type and accepts explicit null as default on creation', async () => {
      expect((await community({ type: 'GUIDE' })).type).toBe('GUIDE');
      expect((await community({ type: null })).type).toBe('GENERAL');
    });

    it('rejects missing/inactive games, foreign/inactive/missing categories and untitled community posts', async () => {
      for (const extra of [
        { gameId: 'missing-game' },
        { gameId: inactiveGameId },
        { categoryId: otherCategoryId },
        { categoryId: inactiveCategoryId },
        { categoryId: 'missing-category' },
      ]) {
        await http()
          .post('/posts')
          .send({
            gameId,
            title: 'Invalid community',
            content: 'Body',
            ...extra,
          })
          .expect(404);
      }
      await http()
        .post('/posts')
        .send({ gameId, content: 'Title required' })
        .expect(400);
    });

    it('enforces the classification CHECK at the database boundary', async () => {
      await expect(
        db.post.create({
          data: {
            authorId: author,
            title: '',
            content: 'Invalid',
            type: 'GUIDE',
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.post.create({
          data: { authorId: author, title: '', content: 'Invalid', categoryId },
        }),
      ).rejects.toThrow();
      await expect(
        db.post.create({
          data: {
            authorId: author,
            gameId,
            title: 'Missing type',
            content: 'Invalid',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('edits, publication and deletion', () => {
    it('edits personal title/content/visibility/tags without changing classification', async () => {
      const post = await create();
      await http()
        .patch(`/posts/${post.id}`)
        .send({
          title: 'New title',
          content: 'Edited body',
          visibility: 'FOLLOWERS_ONLY',
          tags: [`${prefix}-edited`],
        })
        .expect(200);
      expect(await persisted(post.id)).toMatchObject({
        title: 'New title',
        content: 'Edited body',
        visibility: 'FOLLOWERS_ONLY',
        gameId: null,
        type: null,
        categoryId: null,
      });
      const cleared = await http()
        .patch(`/posts/${post.id}`)
        .send({ type: null, categoryId: null })
        .expect(200);
      expect(cleared.body.type).toBeNull();
      for (const change of [
        { title: null },
        { type: 'GUIDE' },
        { categoryId },
        { gameId },
        { gameId: null },
        { media: [] },
      ]) {
        await http().patch(`/posts/${post.id}`).send(change).expect(400);
      }
      // Media replacement is not supported by the existing UpdatePostDto.
    });

    it('preserves community edits, category clearing and immutable game association', async () => {
      const post = await community();
      await http()
        .patch(`/posts/${post.id}`)
        .send({ type: 'BUILD', categoryId, title: 'Updated community' })
        .expect(200);
      expect(await persisted(post.id)).toMatchObject({
        gameId,
        type: 'BUILD',
        categoryId,
      });
      for (const change of [
        { categoryId: otherCategoryId },
        { categoryId: inactiveCategoryId },
      ]) {
        await http().patch(`/posts/${post.id}`).send(change).expect(404);
      }
      for (const change of [
        { gameId: otherGameId },
        { title: null },
        { gameId: null },
        { type: null },
      ]) {
        await http().patch(`/posts/${post.id}`).send(change).expect(400);
      }
      await http()
        .patch(`/posts/${post.id}`)
        .send({ categoryId: null })
        .expect(200);
      expect((await persisted(post.id)).categoryId).toBeNull();
    });

    it.each([false, true])(
      'keeps draft/publication/delete counters exact for game=%s',
      async (game) => {
        const before = await counter();
        const post = await (game
          ? community({ status: 'DRAFT' })
          : create({ status: 'DRAFT' }));
        expect(await counter()).toBe(before);
        for (const status of [
          'PUBLISHED',
          'PUBLISHED',
          'DRAFT',
          'DRAFT',
          'PUBLISHED',
        ]) {
          await http().patch(`/posts/${post.id}`).send({ status }).expect(200);
          expect(await counter()).toBe(
            before + (game && status === 'PUBLISHED' ? 1 : 0),
          );
        }
        await http().delete(`/posts/${post.id}`).expect(200);
        expect(await persisted(post.id)).toMatchObject({
          status: 'DELETED',
          deletedAt: expect.any(Date),
        });
        expect(await counter()).toBe(before);
        await http().delete(`/posts/${post.id}`).expect(404);
        // Repository duplicate deletion is a no-op even though HTTP returns 404.
        await app.get(PostsRepository).softDelete(post.id);
        expect(await counter()).toBe(before);
        await http().get(`/posts/${post.id}`).expect(404);
        await http()
          .patch(`/posts/${post.id}`)
          .send({ content: 'Cannot edit deleted' })
          .expect(404);
      },
    );

    it.each([false, true])(
      'deletes drafts without decrementing counters: game=%s',
      async (game) => {
        const before = await counter();
        const post = await (game
          ? community({ status: 'DRAFT' })
          : create({ status: 'DRAFT' }));
        await http().delete(`/posts/${post.id}`).expect(200);
        expect(await counter()).toBe(before);
      },
    );

    it('rejects non-owner edits/deletion and edits to hidden content', async () => {
      const post = await create();
      await http()
        .patch(`/posts/${post.id}`)
        .set('x-test-user', viewer)
        .send({ content: 'Not owner' })
        .expect(403);
      await http()
        .delete(`/posts/${post.id}`)
        .set('x-test-user', viewer)
        .expect(403);
      await http()
        .patch(`/admin/posts/${post.id}/hide`)
        .set('x-test-user', admin)
        .expect(200);
      await http()
        .patch(`/posts/${post.id}`)
        .send({ status: 'PUBLISHED' })
        .expect(403);
      await http().delete(`/posts/${post.id}`).expect(200);
    });
  });

  describe('reads, feeds and saves', () => {
    it('hydrates personal detail, author/profile, search, Latest, Trending and For You', async () => {
      const tag = `${prefix}-discovery`;
      const post = await create({ tags: [tag] });
      const tagRow = await db.tag.findUniqueOrThrow({ where: { slug: tag } });
      // Strong fixture engagement makes selection deterministic among unrelated
      // development data, without changing production query/ranking behavior.
      await db.post.update({
        where: { id: post.id },
        data: { reactionCount: 1_000_000 },
      });
      await db.userInterest.upsert({
        where: {
          userId_entityType_entityId: {
            userId: viewer,
            entityType: 'TAG',
            entityId: tagRow.id,
          },
        },
        create: {
          userId: viewer,
          entityType: 'TAG',
          entityId: tagRow.id,
          score: 100,
          signalCount: 1,
        },
        update: { score: 100 },
      });
      const detail = await http().get(`/posts/${post.id}`).expect(200);
      expect(detail.body).toMatchObject({
        gameId: null,
        game: null,
        type: null,
        category: null,
      });
      for (const path of [
        `/users/${author}/posts?limit=100`,
        '/posts/mine?limit=100',
        `/posts?search=${runId}&limit=100`,
        '/feed/latest?limit=100',
        '/feed/trending?limit=100',
        '/feed/for-you?limit=100',
      ]) {
        const result = await http()
          .get(path)
          .set('x-test-user', path.startsWith('/posts/mine') ? author : viewer)
          .expect(200);
        expect(result.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: post.id, game: null, type: null }),
          ]),
        );
      }
      const gamePost = await community();
      for (const sort of ['latest', 'trending']) {
        const result = await http()
          .get(`/games/${slug}/feed?sort=${sort}&limit=100`)
          .expect(200);
        expect(result.body.items.map((row: any) => row.id)).toContain(
          gamePost.id,
        );
        expect(result.body.items.map((row: any) => row.id)).not.toContain(
          post.id,
        );
      }
      const filtered = await http()
        .get('/posts?type=GUIDE&limit=100')
        .expect(200);
      expect(filtered.body.items.map((row: any) => row.id)).not.toContain(
        post.id,
      );
    });

    it('continues real Trending/For You snapshot hydration with nullable candidates', async () => {
      const posts = await Promise.all(
        Array.from({ length: 4 }, () => create()),
      );
      const ids = posts.map((p) => p.id);
      await db.post.updateMany({
        where: { id: { in: ids } },
        data: { reactionCount: 1_000_000 },
      });
      const candidates = await app
        .get(FeedRepository)
        .findRecentForYouCandidates({ id: { in: ids } }, 10);
      expect(candidates).toHaveLength(4);
      expect(
        candidates.every((row) => row.gameId === null && row.type === null),
      ).toBe(true);
      const ranker = app.get(FeedRankerService);
      const profile = {
        games: {},
        categories: {},
        postTypes: {},
        tags: {},
        authors: {},
        hasSignals: true,
      };
      const baseline = ranker.rankForYou([candidates[0]], profile, new Set());
      const affinity = ranker.rankForYou(
        [candidates[0]],
        { ...profile, authors: { [candidates[0].authorId]: 1 } },
        new Set(),
      );
      expect(affinity[0].score).toBeGreaterThan(baseline[0].score);
      const ranked = app.get(FeedRankerService).rankForYou(
        candidates.map((row, i) => ({ ...row, authorId: `diversity-${i}` })),
        {
          games: {},
          categories: {},
          postTypes: {},
          tags: {},
          authors: {},
          hasSignals: false,
        },
        new Set(),
      );
      const gameCandidate = {
        ...ranked[0],
        id: 'diversity-game',
        gameId,
        authorId: 'other-author',
        score: -1,
      };
      expect(
        app
          .get(FeedRankerService)
          .diversifyForYou([...ranked, gameCandidate])
          .slice(0, 4)
          .map((row) => row.id),
      ).toEqual(ranked.map((row) => row.id));
      const realGameRanked = ranked.map((row) => ({ ...row, gameId }));
      expect(
        app
          .get(FeedRankerService)
          .diversifyForYou([
            ...realGameRanked,
            { ...gameCandidate, gameId: otherGameId },
          ])[3].id,
      ).toBe('diversity-game');
      for (const endpoint of ['/feed/trending', '/feed/for-you']) {
        const first = await http()
          .get(`${endpoint}?limit=1`)
          .set('x-test-user', viewer)
          .expect(200);
        expect(first.body.meta.nextCursor).toEqual(expect.any(String));
        const next = await http()
          .get(
            `${endpoint}?limit=1&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
          )
          .set('x-test-user', viewer)
          .expect(200);
        expect(next.body.items).toHaveLength(1);
        expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
      }
    });

    it.each(['PRIVATE', 'FOLLOWERS_ONLY', 'DRAFT'] as const)(
      'preserves privacy/access for personal %s posts',
      async (mode) => {
        const post = await create(
          mode === 'DRAFT' ? { status: 'DRAFT' } : { visibility: mode },
        );
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', author)
          .expect(200);
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', viewer)
          .expect(404);
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', 'anonymous')
          .expect(404);
        await http()
          .post(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(404);
        await http()
          .post(`/posts/${post.id}/like`)
          .set('x-test-user', viewer)
          .expect(404);
        await http()
          .post(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .send({ content: 'Not visible' })
          .expect(404);
        await http()
          .get(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .expect(404);
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', follower)
          .expect(mode === 'FOLLOWERS_ONLY' ? 200 : 404);
        const profile = await http()
          .get(`/users/${author}/posts?limit=100`)
          .set('x-test-user', viewer)
          .expect(200);
        expect(profile.body.items.map((row: any) => row.id)).not.toContain(
          post.id,
        );
      },
    );

    it.each([false, true])(
      'save/unsave is idempotent with nullable mapping and pagination: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        for (let i = 0; i < 2; i++)
          await http()
            .post(`/posts/${post.id}/save`)
            .set('x-test-user', viewer)
            .expect(201);
        expect(
          await db.postSave.count({
            where: { postId: post.id, userId: viewer },
          }),
        ).toBe(1);
        const detail = await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', viewer)
          .expect(200);
        expect(detail.body.savedByCurrentUser).toBe(true);
        const saved = await http()
          .get('/posts/saved?limit=1')
          .set('x-test-user', viewer)
          .expect(200);
        expect(saved.body.items[0]).toMatchObject({
          id: post.id,
          savedByCurrentUser: true,
          type: game ? 'GENERAL' : null,
        });
        if (!game) expect(saved.body.items[0].game).toBeNull();
        await http()
          .delete(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(200);
        await http()
          .delete(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(200);
        expect(
          await db.postSave.count({
            where: { postId: post.id, userId: viewer },
          }),
        ).toBe(0);
        await http()
          .post(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(201);
        await http().delete(`/posts/${post.id}`).expect(200);
        await http()
          .post(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(404);
        const after = await http()
          .get('/posts/saved')
          .set('x-test-user', viewer)
          .expect(200);
        expect(after.body.items.map((row: any) => row.id)).not.toContain(
          post.id,
        );
        await http()
          .delete(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(200);
      },
    );

    it('saved pagination preserves nullable rows across cursors', async () => {
      const posts = [await create(), await community()];
      for (const post of posts)
        await http()
          .post(`/posts/${post.id}/save`)
          .set('x-test-user', follower)
          .expect(201);
      const first = await http()
        .get('/posts/saved?limit=1')
        .set('x-test-user', follower)
        .expect(200);
      const second = await http()
        .get(
          `/posts/saved?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        )
        .set('x-test-user', follower)
        .expect(200);
      expect(
        new Set([first.body.items[0].id, second.body.items[0].id]),
      ).toEqual(new Set(posts.map((p) => p.id)));
      await http()
        .get('/posts/saved?cursor=invalid')
        .set('x-test-user', follower)
        .expect(400);
    });
  });

  describe('interactions, mentions, durable events and notification mapping', () => {
    it.each([false, true])(
      'persists like/unlike counters, idempotent events and valid interests: game=%s',
      async (game) => {
        await db.userInterest.deleteMany({ where: { userId: viewer } });
        const tag = `${prefix}-interaction-${game}`;
        const post = await (game
          ? community({ tags: [tag], type: 'GUIDE' })
          : create({ tags: [tag] }));
        for (let i = 0; i < 2; i++)
          await http()
            .post(`/posts/${post.id}/like`)
            .set('x-test-user', viewer)
            .expect(201);
        await flushSignals();
        expect((await persisted(post.id)).reactionCount).toBe(1);
        expect(
          await db.postLike.count({
            where: { postId: post.id, userId: viewer },
          }),
        ).toBe(1);
        expect(
          await db.outboxEvent.count({
            where: { aggregateId: post.id, type: 'post.liked' },
          }),
        ).toBe(1);
        const interests = await db.userInterest.findMany({
          where: { userId: viewer },
        });
        expect(interests.map((row) => row.entityType).sort()).toEqual(
          game ? ['AUTHOR', 'GAME', 'POST_TYPE', 'TAG'] : ['AUTHOR', 'TAG'],
        );
        expect(
          interests.every(
            (row) =>
              typeof row.entityId === 'string' && row.entityId !== 'null',
          ),
        ).toBe(true);
        const detail = await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', viewer)
          .expect(200);
        expect(detail.body.likedByCurrentUser).toBe(true);
        const events = await dispatchEvents([post.id]);
        expect(events[0].payload).toMatchObject({
          postId: post.id,
          postAuthorId: author,
          actorId: viewer,
        });
        const notifications = await http()
          .get('/notifications?limit=50')
          .expect(200);
        expect(notifications.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'POST_LIKED', entityId: post.id }),
          ]),
        );
        await dispatchEvents([post.id]);
        expect(
          await db.notification.count({
            where: {
              recipientId: author,
              entityId: post.id,
              type: 'POST_LIKED',
            },
          }),
        ).toBe(1);
        for (let i = 0; i < 2; i++)
          await http()
            .delete(`/posts/${post.id}/like`)
            .set('x-test-user', viewer)
            .expect(200);
        await flushSignals();
        expect((await persisted(post.id)).reactionCount).toBe(0);
      },
    );

    it.each([false, true])(
      'creates/lists comments and replies with real events and signals: game=%s',
      async (game) => {
        await db.userInterest.deleteMany({ where: { userId: viewer } });
        const post = await (game ? community() : create());
        const root = await http()
          .post(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .send({ content: 'Root comment' })
          .expect(201);
        aggregates.add(root.body.id);
        const reply = await http()
          .post(`/comments/${root.body.id}/replies`)
          .set('x-test-user', follower)
          .send({ content: 'Reply' })
          .expect(201);
        aggregates.add(reply.body.id);
        const roots = await http()
          .get(`/posts/${post.id}/comments`)
          .expect(200);
        expect(roots.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: root.body.id }),
          ]),
        );
        const replies = await http()
          .get(`/comments/${root.body.id}/replies`)
          .expect(200);
        expect(replies.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: reply.body.id }),
          ]),
        );
        await http()
          .post(`/comments/${reply.body.id}/replies`)
          .send({ content: 'Nested reply' })
          .expect(403);
        await flushSignals();
        expect((await persisted(post.id)).commentCount).toBe(2);
        const interests = await db.userInterest.findMany({
          where: { userId: viewer },
        });
        expect(interests.map((row) => row.entityType).sort()).toEqual(
          game ? ['AUTHOR', 'GAME', 'POST_TYPE'] : ['AUTHOR'],
        );
        const events = await dispatchEvents([root.body.id, reply.body.id]);
        expect(events).toHaveLength(2);
        expect(events.every((e) => (e.payload as any).postId === post.id)).toBe(
          true,
        );
        const authorNotifications = await http()
          .get('/notifications?limit=50')
          .expect(200);
        expect(authorNotifications.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'POST_COMMENTED',
              entityId: root.body.id,
              postId: post.id,
            }),
          ]),
        );
        const replyNotifications = await http()
          .get('/notifications?limit=50')
          .set('x-test-user', viewer)
          .expect(200);
        expect(replyNotifications.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'COMMENT_REPLIED',
              entityId: reply.body.id,
              postId: post.id,
            }),
          ]),
        );
      },
    );

    it('parses real mentions, stores durable evidence/outbox, and suppresses draft/duplicate/private pings', async () => {
      const body = `Hello @${mentionHandle}`;
      const post = await create({ content: body, status: 'DRAFT' });
      expect(await db.mention.count({ where: { entityId: post.id } })).toBe(0);
      await http()
        .patch(`/posts/${post.id}`)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect(
        await db.mention.count({
          where: { entityId: post.id, userId: viewer },
        }),
      ).toBe(1);
      for (const content of ['Removed mention', body])
        await http().patch(`/posts/${post.id}`).send({ content }).expect(200);
      const events = await dispatchEvents([post.id]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'user.mentioned',
        payload: {
          targetUserId: viewer,
          actorId: author,
          entityType: 'POST',
          entityId: post.id,
        },
      });
      const notifications = await http()
        .get('/notifications?limit=50')
        .set('x-test-user', viewer)
        .expect(200);
      expect(notifications.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'USER_MENTIONED',
            entityType: 'POST',
            entityId: post.id,
          }),
        ]),
      );
      const privatePost = await create({
        content: body,
        visibility: 'PRIVATE',
      });
      expect(
        await db.mention.count({ where: { entityId: privatePost.id } }),
      ).toBe(0);
      const published = await create({ content: body });
      expect(
        await db.mention.count({
          where: { entityId: published.id, userId: viewer },
        }),
      ).toBe(1);
      const comment = await http()
        .post(`/posts/${published.id}/comments`)
        .send({ content: body })
        .expect(201);
      aggregates.add(comment.body.id);
      expect(
        await db.mention.count({
          where: { entityId: comment.body.id, userId: viewer },
        }),
      ).toBe(1);
      await dispatchEvents([comment.body.id]);
      const mapped = await http()
        .get('/notifications?limit=50')
        .set('x-test-user', viewer)
        .expect(200);
      expect(mapped.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'USER_MENTIONED',
            entityId: comment.body.id,
            postId: published.id,
          }),
        ]),
      );
    });
  });
  describe('moderation permissions, transitions and atomic audit', () => {
    it.each([false, true])(
      'moderates posts with exact counters/idempotency and audit context: game=%s',
      async (game) => {
        const before = await counter();
        const post = await (game ? community() : create());
        const base = game
          ? `/games/${slug}/posts/${post.id}`
          : `/admin/posts/${post.id}`;
        const actor = game ? moderator : admin;
        for (let i = 0; i < 2; i++)
          await http()
            .patch(`${base}/hide`)
            .set('x-test-user', actor)
            .expect(200);
        expect((await persisted(post.id)).status).toBe('HIDDEN');
        expect(await counter()).toBe(before);
        await http()
          .get(`/posts/${post.id}`)
          .set('x-test-user', viewer)
          .expect(404);
        await http()
          .post(`/posts/${post.id}/save`)
          .set('x-test-user', viewer)
          .expect(404);
        for (let i = 0; i < 2; i++)
          await http()
            .patch(`${base}/restore`)
            .set('x-test-user', actor)
            .expect(200);
        expect(await counter()).toBe(before + (game ? 1 : 0));
        const audit = await db.auditLog.findMany({
          where: { targetId: post.id },
        });
        expect(audit).toHaveLength(2);
        expect(audit.map((row) => row.action).sort()).toEqual([
          'POST_HIDDEN',
          'POST_RESTORED',
        ]);
        expect(
          audit.every((row) => row.gameId === (game ? gameId : null)),
        ).toBe(true);
        if (game) {
          await http()
            .patch(`/games/${slug}/posts/${post.id}/hide`)
            .set('x-test-user', admin)
            .expect(200);
          expect(await counter()).toBe(before);
        }
      },
    );

    it.each([false, true])(
      'moderates comments with visible-count and audit invariants: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const response = await http()
          .post(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .send({ content: 'Moderate me' })
          .expect(201);
        const id = response.body.id;
        aggregates.add(id);
        const base = game
          ? `/games/${slug}/comments/${id}`
          : `/admin/comments/${id}`;
        const actor = game ? moderator : admin;
        const before = await counter();
        for (let i = 0; i < 2; i++)
          await http()
            .patch(`${base}/hide`)
            .set('x-test-user', actor)
            .expect(200);
        expect((await persisted(post.id)).commentCount).toBe(0);
        await http()
          .post(`/comments/${id}/replies`)
          .send({ content: 'Hidden root' })
          .expect(404);
        for (let i = 0; i < 2; i++)
          await http()
            .patch(`${base}/restore`)
            .set('x-test-user', actor)
            .expect(200);
        expect((await persisted(post.id)).commentCount).toBe(1);
        expect(await counter()).toBe(before);
        const audit = await db.auditLog.findMany({ where: { targetId: id } });
        expect(audit).toHaveLength(2);
        expect(
          audit.every((row) => row.gameId === (game ? gameId : null)),
        ).toBe(true);
      },
    );

    it('prevents game moderators accessing personal content and wrong-game resources', async () => {
      const post = await create();
      const comment = await http()
        .post(`/posts/${post.id}/comments`)
        .send({ content: 'Personal' })
        .expect(201);
      aggregates.add(comment.body.id);
      const gamePost = await community();
      for (const action of ['hide', 'restore']) {
        for (const [kind, id] of [
          ['posts', post.id],
          ['comments', comment.body.id],
        ]) {
          await http()
            .patch(`/games/${slug}/${kind}/${id}/${action}`)
            .set('x-test-user', moderator)
            .expect(404);
          await http()
            .patch(`/admin/${kind}/${id}/${action}`)
            .set('x-test-user', moderator)
            .expect(403);
        }
        await http()
          .patch(`/games/${otherSlug}/posts/${gamePost.id}/${action}`)
          .set('x-test-user', admin)
          .expect(404);
      }
      await http()
        .patch(`/admin/posts/${gamePost.id}/hide`)
        .set('x-test-user', admin)
        .expect(404);
      expect((await persisted(post.id)).status).toBe('PUBLISHED');
    });

    it('authorizes before probing resource existence and rejects inactive admins/moderators', async () => {
      const post = await community();
      for (const id of [post.id, 'does-not-exist']) {
        await http()
          .patch(`/games/${slug}/posts/${id}/hide`)
          .set('x-test-user', viewer)
          .expect(403);
        await http()
          .patch(`/admin/posts/${id}/hide`)
          .set('x-test-user', viewer)
          .expect(403);
      }
      await http()
        .patch(`/games/${slug}/posts/missing/hide`)
        .set('x-test-user', inactive)
        .expect(403);
      await db.user.update({
        where: { id: inactive },
        data: { role: 'ADMIN' },
      });
      await http()
        .patch('/admin/posts/missing/hide')
        .set('x-test-user', inactive)
        .expect(403);
      await http()
        .patch(`/games/${slug}/posts/missing/hide`)
        .set('x-test-user', admin)
        .expect(404);
      const draft = await community({ status: 'DRAFT' });
      await http()
        .patch(`/games/${slug}/posts/${draft.id}/hide`)
        .set('x-test-user', moderator)
        .expect(400);
    });

    it('returns 401 for protected routes without an injected session, while public reads remain available', async () => {
      await http()
        .post('/posts')
        .set('x-test-user', 'anonymous')
        .send({ content: 'No session' })
        .expect(401);
      await http()
        .get('/posts/saved')
        .set('x-test-user', 'anonymous')
        .expect(401);
      await http()
        .patch('/admin/posts/missing/hide')
        .set('x-test-user', 'anonymous')
        .expect(401);
      await http().get('/posts').set('x-test-user', 'anonymous').expect(200);
    });

    it.each([false, true])(
      'rolls back moderation/counters when durable audit fails: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const before = await counter();
        const audit = jest
          .spyOn(app.get(AuditLogRepository), 'create')
          .mockRejectedValueOnce(new Error('Injected audit storage failure'));
        try {
          await http()
            .patch(
              game
                ? `/games/${slug}/posts/${post.id}/hide`
                : `/admin/posts/${post.id}/hide`,
            )
            .set('x-test-user', game ? moderator : admin)
            .expect(500);
          expect((await persisted(post.id)).status).toBe('PUBLISHED');
          expect(await counter()).toBe(before);
          expect(
            await db.auditLog.count({ where: { targetId: post.id } }),
          ).toBe(0);
        } finally {
          audit.mockRestore();
        }
      },
    );

    it('detects a concurrent status change with 409 without double-counting', async () => {
      const post = await community();
      const repository = app.get(PostsRepository);
      const original = repository.transitionStatus.bind(repository);
      const before = await counter();
      const race = jest
        .spyOn(repository, 'transitionStatus')
        .mockImplementationOnce(async (tx, params) => {
          await db.$transaction((t) => original(t, params));
          return original(tx, params);
        });
      try {
        await http()
          .patch(`/games/${slug}/posts/${post.id}/hide`)
          .set('x-test-user', moderator)
          .expect(409);
        expect((await persisted(post.id)).status).toBe('HIDDEN');
        expect(await counter()).toBe(before - 1);
      } finally {
        race.mockRestore();
      }
    });
  });

  describe('Game hard deletion retention and report compatibility', () => {
    it('retains comments/replies, saves, likes and media when Game deletion converts a post to personal', async () => {
      const game = await db.game.create({
        data: { name: 'Retention fixture', slug: `${prefix}-retain` },
      });
      const category = await db.gameCategory.create({
        data: { gameId: game.id, name: 'Retained category', slug: 'retained' },
      });
      const upload = await uploaded();
      const post = await create({
        gameId: game.id,
        categoryId: category.id,
        type: 'GUIDE',
        title: 'Retained history',
        content: `Retained history @${mentionHandle}`,
        media: [{ mediaUploadId: upload.id }],
      });
      const comment = await http()
        .post(`/posts/${post.id}/comments`)
        .set('x-test-user', viewer)
        .send({ content: 'Retained comment' })
        .expect(201);
      const reply = await http()
        .post(`/comments/${comment.body.id}/replies`)
        .set('x-test-user', follower)
        .send({ content: 'Retained reply' })
        .expect(201);
      aggregates.add(comment.body.id);
      aggregates.add(reply.body.id);
      await http()
        .post(`/posts/${post.id}/save`)
        .set('x-test-user', viewer)
        .expect(201);
      await http()
        .post(`/posts/${post.id}/like`)
        .set('x-test-user', viewer)
        .expect(201);
      await flushSignals();
      // Integration boundary: the application has no hard-delete Game API.
      await db.game.delete({ where: { id: game.id } });
      expect(await persisted(post.id)).toMatchObject({
        gameId: null,
        type: null,
        categoryId: null,
        reactionCount: 1,
        commentCount: 2,
      });
      expect(await db.comment.count({ where: { postId: post.id } })).toBe(2);
      expect(await db.postSave.count({ where: { postId: post.id } })).toBe(1);
      expect(await db.postLike.count({ where: { postId: post.id } })).toBe(1);
      expect(
        await db.mention.count({
          where: { entityId: post.id, userId: viewer },
        }),
      ).toBe(1);
      expect(
        await db.postMedia.findUnique({ where: { mediaUploadId: upload.id } }),
      ).toMatchObject({ postId: post.id });
      expect(
        (await db.mediaUpload.findUniqueOrThrow({ where: { id: upload.id } }))
          .status,
      ).toBe('ATTACHED');
      const detail = await http()
        .get(`/posts/${post.id}`)
        .set('x-test-user', viewer)
        .expect(200);
      expect(detail.body).toMatchObject({
        game: null,
        type: null,
        savedByCurrentUser: true,
        likedByCurrentUser: true,
      });
      await http()
        .patch(`/admin/posts/${post.id}/hide`)
        .set('x-test-user', admin)
        .expect(200);
      await http()
        .patch(`/admin/posts/${post.id}/restore`)
        .set('x-test-user', admin)
        .expect(200);
    });

    it.each([false, true])(
      'creates null/game reports with game-scoped case moderation: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const comment = await http()
          .post(`/posts/${post.id}/comments`)
          .send({ content: 'Report target' })
          .expect(201);
        aggregates.add(comment.body.id);
        const reports = app.get(ReportsRepository);
        for (const [targetType, targetId] of [
          ['POST', post.id],
          ['COMMENT', comment.body.id],
        ] as const) {
          expect(
            await reports.findTargetPostInfo(targetType, targetId),
          ).toMatchObject({ gameId: game ? gameId : null });
        }
        const submitted = await http()
          .post('/reports')
          .set('x-test-user', viewer)
          .send({ targetType: 'POST', targetId: post.id, reasonCode: 'OTHER' })
          .expect(201);
        expect(await db.report.count({ where: { targetId: post.id } })).toBe(1);
        const report = await db.report.findUniqueOrThrow({
          where: { id: submitted.body.id },
        });
        caseIds.push(report.caseId);
        const listing = await http()
          .get('/admin/reports?limit=100')
          .set('x-test-user', admin)
          .expect(200);
        expect(listing.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: report.id,
              gameId: game ? gameId : null,
              ...(game ? {} : { game: null }),
            }),
          ]),
        );
        const projection = await reports.findById(report.id);
        expect(projection?.gameId).toBe(game ? gameId : null);
        if (game) {
          for (const [action, status] of [
            ['claim', 200],
            ['resolve', 200],
            ['dismiss', 409],
          ] as const) {
            await http()
              .patch(`/games/${slug}/reports/${report.id}/${action}`)
              .set('x-test-user', moderator)
              .send({})
              .expect(status);
          }
        } else {
          await http()
            .patch(`/games/${slug}/reports/${report.id}/claim`)
            .set('x-test-user', admin)
            .expect(404);
        }
        const content = await http()
          .get('/admin/content?limit=100')
          .set('x-test-user', admin)
          .expect(200);
        const flaggedItems = content.body.items as Array<{
          id: string;
          gameSlug: string | null;
        }>;
        expect(flaggedItems.some((item) => item.id === post.id)).toBe(!game);
        if (!game)
          expect(flaggedItems).toContainEqual(
            expect.objectContaining({ id: String(post.id), gameSlug: null }),
          );
      },
    );
  });
  // Final gate route checklist supplements the creation/lifecycle/feed/save/
  // interaction/moderation/report routes above: comment PATCH/DELETE; hidden
  // lists; user profile; game count projections; report game list; audit reads;
  // dashboard; notification unread/read/read-all. All use production handlers.
  describe('final gate: additional affected read and lifecycle routes', () => {
    it.each([false, true])(
      'edits/deletes comments and replies with exact counts: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const before = await counter();
        const root = await http()
          .post(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .send({ content: 'Original root' })
          .expect(201);
        const reply = await http()
          .post(`/comments/${root.body.id}/replies`)
          .set('x-test-user', viewer)
          .send({ content: 'Original reply' })
          .expect(201);
        aggregates.add(root.body.id);
        aggregates.add(reply.body.id);
        await flushSignals();
        expect((await persisted(post.id)).commentCount).toBe(2);
        for (const id of [root.body.id, reply.body.id]) {
          await http()
            .patch(`/comments/${id}`)
            .send({ content: 'Not mine' })
            .expect(403);
          await http().delete(`/comments/${id}`).expect(403);
          await http()
            .patch(`/comments/${id}`)
            .set('x-test-user', viewer)
            .send({ content: '' })
            .expect(400);
          const edited = await http()
            .patch(`/comments/${id}`)
            .set('x-test-user', viewer)
            .send({ content: 'Edited comment' })
            .expect(200);
          expect(edited.body.content).toBe('Edited comment');
        }
        for (const [index, id] of [reply.body.id, root.body.id].entries()) {
          await http()
            .delete(`/comments/${id}`)
            .set('x-test-user', viewer)
            .expect(200);
          await http()
            .delete(`/comments/${id}`)
            .set('x-test-user', viewer)
            .expect(404);
          await http()
            .patch(`/comments/${id}`)
            .set('x-test-user', viewer)
            .send({ content: 'Deleted' })
            .expect(404);
          expect((await persisted(post.id)).commentCount).toBe(1 - index);
          expect(
            await db.comment.findUniqueOrThrow({ where: { id } }),
          ).toMatchObject({ deletedAt: expect.any(Date) });
        }
        await flushSignals();
        expect(await counter()).toBe(before);
        const interests = await db.userInterest.findMany({
          where: { userId: viewer },
        });
        expect(interests.every((row) => typeof row.entityId === 'string')).toBe(
          true,
        );
        await http()
          .patch('/comments/missing-final-gate')
          .send({ content: 'Missing' })
          .expect(404);
        await http().delete('/comments/missing-final-gate').expect(404);
      },
    );

    it.each([false, true])(
      'hidden lists exclude personal content; hidden comments cannot be edited: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const root = await http()
          .post(`/posts/${post.id}/comments`)
          .set('x-test-user', viewer)
          .send({ content: 'Hidden list fixture' })
          .expect(201);
        aggregates.add(root.body.id);
        const commentBase = game
          ? `/games/${slug}/comments/${root.body.id}`
          : `/admin/comments/${root.body.id}`;
        const postBase = game
          ? `/games/${slug}/posts/${post.id}`
          : `/admin/posts/${post.id}`;
        const as = game ? moderator : admin;
        await http()
          .patch(`${commentBase}/hide`)
          .set('x-test-user', as)
          .expect(200);
        await http()
          .patch(`/comments/${root.body.id}`)
          .set('x-test-user', viewer)
          .send({ content: 'Cannot edit hidden' })
          .expect(403);
        await http()
          .patch(`${postBase}/hide`)
          .set('x-test-user', as)
          .expect(200);
        for (const [kind, id] of [
          ['posts', post.id],
          ['comments', root.body.id],
        ]) {
          const listing = await http()
            .get(`/games/${slug}/${kind}/hidden?limit=100`)
            .set('x-test-user', moderator)
            .expect(200);
          expect(
            listing.body.items.some((item: { id: string }) => item.id === id),
          ).toBe(game);
          await http()
            .get(`/games/${slug}/${kind}/hidden`)
            .set('x-test-user', viewer)
            .expect(403);
        }
        await http()
          .patch(`${postBase}/restore`)
          .set('x-test-user', as)
          .expect(200);
        await http()
          .patch(`${commentBase}/restore`)
          .set('x-test-user', as)
          .expect(200);
      },
    );

    it('reads actual user profiles and Game counter projections', async () => {
      const before = await counter();
      await create();
      await community();
      const profile = await http()
        .get(`/users/${author}`)
        .set('x-test-user', viewer)
        .expect(200);
      expect(profile.body).toMatchObject({ id: author, isBlockedByMe: false });
      const game = await http().get(`/games/${slug}`).expect(200);
      expect(game.body).toMatchObject({ id: gameId, postCount: before + 1 });
      const listing = await http()
        .get(`/games?search=${prefix}&limit=100`)
        .expect(200);
      expect(listing.body.items).toContainEqual(
        expect.objectContaining({ id: gameId, postCount: before + 1 }),
      );
      const moderated = await http()
        .get('/games/moderated')
        .set('x-test-user', moderator)
        .expect(200);
      expect(moderated.body.items ?? moderated.body).toContainEqual(
        expect.objectContaining({ id: gameId }),
      );
      await http().get('/users/missing-final-gate').expect(404);
      await http().get('/games/missing-final-gate').expect(404);
    });

    it('exposes null-context audits through admin/dashboard and excludes them from Game reads', async () => {
      const personal = await create();
      const game = await community();
      await http()
        .patch(`/admin/posts/${personal.id}/hide`)
        .set('x-test-user', admin)
        .expect(200);
      await http()
        .patch(`/games/${slug}/posts/${game.id}/hide`)
        .set('x-test-user', moderator)
        .expect(200);
      const personalAudit = await http()
        .get(`/admin/audit-logs?targetId=${personal.id}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(personalAudit.body.items).toContainEqual(
        expect.objectContaining({
          targetId: personal.id,
          gameId: null,
          gameSlug: null,
        }),
      );
      const gameAudit = await http()
        .get(`/games/${slug}/audit-logs?limit=100`)
        .set('x-test-user', moderator)
        .expect(200);
      expect(gameAudit.body.items).toContainEqual(
        expect.objectContaining({ targetId: game.id, gameId }),
      );
      expect(
        gameAudit.body.items.some(
          (row: { targetId: string }) => row.targetId === personal.id,
        ),
      ).toBe(false);
      const overview = await http()
        .get('/admin/overview')
        .set('x-test-user', admin)
        .expect(200);
      expect(overview.body.activity).toContainEqual(
        expect.objectContaining({
          targetId: personal.id,
          action: 'POST_HIDDEN',
        }),
      );
      expect(
        overview.body.metrics.every((row: { value: number }) =>
          Number.isFinite(row.value),
        ),
      ).toBe(true);
      await http()
        .get('/admin/overview')
        .set('x-test-user', moderator)
        .expect(403);
      await http()
        .get('/admin/audit-logs')
        .set('x-test-user', viewer)
        .expect(403);
      await http()
        .get(`/games/${slug}/audit-logs`)
        .set('x-test-user', viewer)
        .expect(403);
      await http()
        .get('/admin/audit-logs?action=INVALID')
        .set('x-test-user', admin)
        .expect(400);
    });

    it.each([false, true])(
      'lists reports in the correct Game scope: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        const moderationCase = await db.moderationCase.create({
          data: {
            targetType: 'POST',
            targetId: post.id,
            gameId: game ? gameId : null,
          },
        });
        caseIds.push(moderationCase.id);
        const report = await db.report.create({
          data: {
            caseId: moderationCase.id,
            reporterId: viewer,
            targetType: 'POST',
            targetId: post.id,
            reasonCode: 'OTHER',
          },
        });
        const listing = await http()
          .get(`/games/${slug}/reports?limit=100`)
          .set('x-test-user', moderator)
          .expect(200);
        expect(
          listing.body.items.some(
            (row: { id: string }) => row.id === report.id,
          ),
        ).toBe(game);
        await http()
          .get(`/games/${slug}/reports`)
          .set('x-test-user', viewer)
          .expect(403);
        await http()
          .get('/games/missing-final-gate/reports')
          .set('x-test-user', admin)
          .expect(404);
      },
    );

    it.each([false, true])(
      'notification unread/read/read-all preserve post context and ownership: game=%s',
      async (game) => {
        const post = await (game ? community() : create());
        await http()
          .post(`/posts/${post.id}/like`)
          .set('x-test-user', viewer)
          .expect(201);
        await dispatchEvents([post.id]);
        const notification = await db.notification.findFirstOrThrow({
          where: { recipientId: author, entityId: post.id, type: 'POST_LIKED' },
        });
        const before = await db.notification.count({
          where: { recipientId: author, readAt: null },
        });
        const unread = await http()
          .get('/notifications/unread-count')
          .expect(200);
        expect(unread.body.count).toBe(before);
        await http()
          .patch(`/notifications/${notification.id}/read`)
          .set('x-test-user', viewer)
          .expect(404);
        const marked = await http()
          .patch(`/notifications/${notification.id}/read`)
          .expect(200);
        expect(marked.body.readAt).toEqual(expect.any(String));
        await http()
          .patch(`/notifications/${notification.id}/read`)
          .expect(200);
        expect(
          (await http().get('/notifications/unread-count').expect(200)).body
            .count,
        ).toBe(before - 1);
        await http().patch('/notifications/read-all').expect(200);
        await http().patch('/notifications/read-all').expect(200);
        expect(
          (await http().get('/notifications/unread-count').expect(200)).body
            .count,
        ).toBe(0);
        await http()
          .patch('/notifications/missing-final-gate/read')
          .expect(404);
      },
    );
  });

  describe('deterministic Game-deletion races (real PostgreSQL)', () => {
    async function raceFixture() {
      const game = await db.game.create({
        data: { name: 'Race fixture', slug: `${prefix}-race-${randomUUID()}` },
      });
      const post = await create({
        gameId: game.id,
        title: 'Race fixture',
        content: 'Original content',
      });
      return { game, post };
    }

    // Intercept only the read barrier; both reads and writes still execute
    // against PostgreSQL on separate connections. No production query is faked.
    function afterPostRead(
      tx: Prisma.TransactionClient,
      id: string,
      removeGame: () => Promise<unknown>,
    ) {
      let used = false;
      return new Proxy(tx, {
        get(target, key) {
          if (key !== 'post') return Reflect.get(target, key);
          return new Proxy(target.post, {
            get(delegate, method) {
              if (method !== 'findUniqueOrThrow')
                return Reflect.get(delegate, method);
              return async (args: Prisma.PostFindUniqueOrThrowArgs) => {
                const row = await delegate.findUniqueOrThrow(args);
                if (!used && args.where.id === id) {
                  used = true;
                  await removeGame();
                }
                return row;
              };
            },
          });
        },
      });
    }

    it('update rolls back content/status/counter changes if Game deletion wins after the counter snapshot', async () => {
      const { game, post } = await raceFixture();
      const before = await counter();
      const repository = app.get(PostsRepository);
      await expect(
        db.$transaction((tx) =>
          repository.update(
            afterPostRead(tx, post.id, () =>
              db.game.delete({ where: { id: game.id } }),
            ),
            {
              id: post.id,
              data: { status: 'DRAFT', content: 'Must roll back' },
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'P2025' });
      expect(await persisted(post.id)).toMatchObject({
        gameId: null,
        type: null,
        categoryId: null,
        status: 'PUBLISHED',
        content: 'Original content',
      });
      expect(await counter()).toBe(before);
    });

    it('softDelete rolls back status/deletedAt if Game deletion wins after its read', async () => {
      const { game, post } = await raceFixture();
      const transaction = db.$transaction.bind(db);
      const intercept = jest
        .spyOn(db, '$transaction')
        .mockImplementationOnce(((
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: unknown,
        ) =>
          transaction(
            (tx) =>
              work(
                afterPostRead(tx, post.id, () =>
                  db.game.delete({ where: { id: game.id } }),
                ),
              ),
            options as never,
          )) as never);
      try {
        await expect(
          app.get(PostsRepository).softDelete(post.id),
        ).rejects.toMatchObject({ code: 'P2025' });
      } finally {
        intercept.mockRestore();
      }
      expect(await persisted(post.id)).toMatchObject({
        gameId: null,
        type: null,
        status: 'PUBLISHED',
        deletedAt: null,
      });
    });

    it('post moderation rejects stale game ownership with 409 and no audit/counter write', async () => {
      const { game, post } = await raceFixture();
      const repository = app.get(PostsRepository);
      const read = repository.findById.bind(repository);
      const reads: {
        findById(
          id: string,
        ): Promise<Awaited<ReturnType<PostsRepository['findById']>>>;
      } = repository;
      const barrier = jest
        .spyOn(reads, 'findById')
        .mockImplementationOnce(async (id) => {
          const snapshot = await read(id);
          await db.game.delete({ where: { id: game.id } });
          return snapshot;
        });
      try {
        await http()
          .patch(`/games/${game.slug}/posts/${post.id}/hide`)
          .set('x-test-user', admin)
          .expect(409);
      } finally {
        barrier.mockRestore();
      }
      expect(await persisted(post.id)).toMatchObject({
        gameId: null,
        type: null,
        status: 'PUBLISHED',
      });
      expect(await db.auditLog.count({ where: { targetId: post.id } })).toBe(0);
    });

    it('comment moderation rolls back when deleted Game context cannot be audited', async () => {
      const { game, post } = await raceFixture();
      const comment = await http()
        .post(`/posts/${post.id}/comments`)
        .send({ content: 'Race comment' })
        .expect(201);
      aggregates.add(comment.body.id);
      const repository = app.get(CommentsRepository);
      const read = repository.findByIdForModeration.bind(repository);
      const reads: {
        findByIdForModeration(
          id: string,
        ): Promise<
          Awaited<ReturnType<CommentsRepository['findByIdForModeration']>>
        >;
      } = repository;
      const barrier = jest
        .spyOn(reads, 'findByIdForModeration')
        .mockImplementationOnce(async (id) => {
          const snapshot = await read(id);
          await db.game.delete({ where: { id: game.id } });
          return snapshot;
        });
      try {
        // Internal integration boundary: existing audit FK failure is propagated,
        // but its transaction must not commit a personal-content moderation act.
        await expect(
          app
            .get(CommentModerationService)
            .hideAsModerator(game.slug, comment.body.id, admin),
        ).rejects.toMatchObject({ code: 'P2003' });
      } finally {
        barrier.mockRestore();
      }
      expect(
        await db.comment.findUniqueOrThrow({ where: { id: comment.body.id } }),
      ).toMatchObject({ status: 'PUBLISHED' });
      expect((await persisted(post.id)).commentCount).toBe(1);
      expect(
        await db.auditLog.count({ where: { targetId: comment.body.id } }),
      ).toBe(0);
    });
  });
});
