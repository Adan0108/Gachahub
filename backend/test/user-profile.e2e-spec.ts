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
import { BlocksRepository } from '../src/blocks/blocks.repository';
import { BlocksService } from '../src/blocks/blocks.service';
import { EventPublisherPort } from '../src/domain-events/event-publisher.port';
import { FollowsController } from '../src/follows/follows.controller';
import { FollowsRepository } from '../src/follows/follows.repository';
import { FollowsService } from '../src/follows/follows.service';
import { PostsRepository } from '../src/posts/posts.repository';
import { PostsService } from '../src/posts/posts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfileAccessService } from '../src/profile-access/profile-access.service';
import { UserProfileService } from '../src/users/profile/user-profile.service';

// Real HTTP routes, validation, services and PostgreSQL. Run it against a throwaway database
// (DATABASE_URL), never the shared one. Sessions are injected; this does not test login.
describe('User profiles and follows (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let profiles: UserProfileService;
  let blocks: BlocksService;
  const token = randomUUID();
  const id = (name: string) => `up-${name}-${token}`;
  const me = id('me');
  const ann = id('ann');
  const bo = id('bo');
  const cy = id('cy');
  const di = id('di');
  const suspended = id('suspended');
  const users = [me, ann, bo, cy, di, suspended];

  const as = (user?: string) => (user ? { 'x-test-user': user } : {});
  const get = (path: string, user?: string) =>
    request(app.getHttpServer()).get(path).set(as(user));
  const follow = (user: string, target: string) =>
    request(app.getHttpServer()).post(`/users/${target}/follow`).set(as(user));

  /** Makes `follower` follow `target` at a fixed time, so the order is certain. */
  const followAt = (follower: string, target: string, minute: number) =>
    db.userFollow.create({
      data: {
        followerId: follower,
        followingId: target,
        createdAt: new Date(2026, 9, 1, 10, minute),
      },
    });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FollowsController],
      providers: [
        PrismaService,
        FollowsService,
        FollowsRepository,
        BlocksService,
        BlocksRepository,
        ProfileAccessService,
        UserProfileService,
        PostsRepository,
        {
          provide: PostsService,
          useFactory: (repository: PostsRepository) => ({
            countByAuthorPublic: (author: string, viewer?: string) =>
              repository.countPublicByAuthor(author, viewer),
          }),
          inject: [PostsRepository],
        },
        { provide: EventPublisherPort, useValue: { publish: async () => {} } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      const user = req.headers['x-test-user'];
      if (user) req.session = { user: { id: user } };
      next();
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
    profiles = app.get(UserProfileService);
    blocks = app.get(BlocksService);

    await db.user.createMany({
      data: users.map((userId) => ({
        id: userId,
        name: `Name ${userId.slice(3, 8)}`,
        email: `${userId}@example.invalid`,
        status: userId === suspended ? 'SUSPENDED' : 'ACTIVE',
      })),
    });
  });

  afterAll(async () => {
    if (db) {
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });

  beforeEach(async () => {
    await db.userFollow.deleteMany({
      where: {
        OR: [{ followerId: { in: users } }, { followingId: { in: users } }],
      },
    });
    await db.chatUserBlock.deleteMany({
      where: {
        OR: [{ blockerId: { in: users } }, { blockedId: { in: users } }],
      },
    });
  });

  describe('bio', () => {
    it('is saved, shown on the public profile, and cleared by null', async () => {
      await db.user.update({
        where: { id: ann },
        data: { bio: 'hello there' },
      });

      expect(await profiles.getPublicProfile(ann, me)).toMatchObject({
        bio: 'hello there',
      });

      await db.user.update({ where: { id: ann }, data: { bio: null } });
      expect(await profiles.getPublicProfile(ann, me)).toMatchObject({
        bio: null,
      });
    });

    it('cannot be longer than 160 characters in the database', async () => {
      await expect(
        db.user.update({ where: { id: ann }, data: { bio: 'x'.repeat(161) } }),
      ).rejects.toThrow();
    });
  });

  describe('counts and relation on the public profile', () => {
    it('counts followers, following and posts, and says how the viewer relates', async () => {
      await followAt(bo, ann, 1);
      await followAt(cy, ann, 2);
      await followAt(ann, bo, 3);
      await db.post.create({
        data: { authorId: ann, content: 'hello', title: 'A post here' },
      });

      const profile = await profiles.getPublicProfile(ann, bo);

      expect(profile).toMatchObject({
        id: ann,
        isFollowing: true,
        followsYou: true,
        isBlockedByMe: false,
        isPrivate: false,
      });
      expect(profile.counts).toMatchObject({ followers: 2, following: 1 });
      expect(profile.counts?.posts).toBe(1);
    });

    it('does not count suspended people among followers', async () => {
      await followAt(bo, ann, 1);
      await followAt(suspended, ann, 2);

      const profile = await profiles.getPublicProfile(ann, me);

      expect(profile.counts?.followers).toBe(1);
    });
  });

  describe('lists of followers and following', () => {
    beforeEach(async () => {
      // Oldest to newest: bo, cy, di follow ann.
      await followAt(bo, ann, 1);
      await followAt(cy, ann, 2);
      await followAt(di, ann, 3);
      await followAt(suspended, ann, 4);
    });

    const ids = (body: { items: { id: string }[] }) =>
      body.items.map((item) => item.id);

    it('lists followers newest first, without anyone suspended', async () => {
      const response = await get(`/users/${ann}/followers`, me).expect(200);

      expect(ids(response.body)).toEqual([di, cy, bo]);
      expect(response.body.nextCursor).toBeNull();
    });

    it('pages with a cursor, every person once and in order', async () => {
      const first = await get(`/users/${ann}/followers?limit=2`, me).expect(
        200,
      );
      expect(ids(first.body)).toEqual([di, cy]);
      expect(first.body.nextCursor).toBe(cy);

      const second = await get(
        `/users/${ann}/followers?limit=2&cursor=${first.body.nextCursor}`,
        me,
      ).expect(200);
      expect(ids(second.body)).toEqual([bo]);
      expect(second.body.nextCursor).toBeNull();
    });

    it('lists who a user follows', async () => {
      await followAt(ann, bo, 5);
      await followAt(ann, cy, 6);

      const response = await get(`/users/${ann}/following`, me).expect(200);

      expect(ids(response.body)).toEqual([cy, bo]);
    });

    it('says whether the viewer follows each person, and whether they follow back', async () => {
      await followAt(me, cy, 7);
      await followAt(di, me, 8);

      const response = await get(`/users/${ann}/followers`, me).expect(200);

      const byId = Object.fromEntries(
        response.body.items.map((item: { id: string }) => [item.id, item]),
      );
      expect(byId[cy]).toMatchObject({ isFollowing: true, followsYou: false });
      expect(byId[di]).toMatchObject({ isFollowing: false, followsYou: true });
      expect(byId[bo]).toMatchObject({ isFollowing: false, followsYou: false });
    });

    it('works without signing in', async () => {
      const response = await get(`/users/${ann}/followers`).expect(200);

      expect(ids(response.body)).toEqual([di, cy, bo]);
    });

    it('leaves out people blocked either way with the viewer', async () => {
      await blocks.block(me, cy);
      await db.chatUserBlock.create({ data: { blockerId: di, blockedId: me } });

      const response = await get(`/users/${ann}/followers`, me).expect(200);

      expect(ids(response.body)).toEqual([bo]);
    });

    it('is 404 for an unknown or suspended user, and 400 for a bad limit', async () => {
      await get(`/users/nobody-${token}/followers`, me).expect(404);
      await get(`/users/${suspended}/followers`, me).expect(404);
      await get(`/users/${ann}/followers?limit=0`, me).expect(400);
      await get(`/users/${ann}/followers?limit=51`, me).expect(400);
    });
  });

  describe('blocking', () => {
    it('ends the follows between the two, in both directions', async () => {
      await followAt(me, bo, 1);
      await followAt(bo, me, 2);
      await followAt(me, cy, 3);

      await blocks.block(me, bo);

      const left = await db.userFollow.findMany({
        where: { OR: [{ followerId: me }, { followingId: me }] },
      });
      expect(left.map((row) => row.followingId)).toEqual([cy]);
    });

    it('stops a follow in either direction of a block', async () => {
      await blocks.block(me, bo);

      await follow(me, bo).expect(403);
      await follow(bo, me).expect(403);
      expect(
        await db.userFollow.count({ where: { followerId: { in: [me, bo] } } }),
      ).toBe(0);
    });

    it('still lets people follow each other when nobody is blocked', async () => {
      await follow(me, bo).expect(201);

      const profile = await profiles.getPublicProfile(bo, me);
      expect(profile).toMatchObject({ isFollowing: true });
    });
  });
});
