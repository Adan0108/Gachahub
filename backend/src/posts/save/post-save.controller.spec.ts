jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../follows/follows.service', () => ({
  FollowsService: class {},
}));
jest.mock('../posts.service', () => ({ PostsService: class {} }));
jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    OptionalAuth: () => common.SetMetadata('OPTIONAL', true),
    Session: () =>
      common.createParamDecorator(
        (
          _data: unknown,
          context: import('@nestjs/common').ExecutionContext,
        ) => {
          return context.switchToHttp().getRequest<{
            session: import('@thallesp/nestjs-better-auth').UserSession | null;
          }>().session;
        },
      )(),
  };
});
import { Reflector } from '@nestjs/core';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { PostsRepository } from '../posts.repository';
import { PostSaveRepository } from './post-save.repository';
import { FollowsService } from '../../follows/follows.service';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { PostSaveController } from './post-save.controller';
import { PostSaveService } from './post-save.service';
import { PostVisibilityService } from '../../post-visibility/post-visibility.service';
import { PostsController } from '../posts.controller';
import { PostsService } from '../posts.service';
import { encodeSavedPostCursor } from './saved-post-cursor.util';

describe('Save Post HTTP contract', () => {
  let app: INestApplication<Server>;
  const repository: jest.Mocked<
    Pick<PostSaveRepository, 'save' | 'unsave' | 'findSavedPage'>
  > = {
    save: jest.fn(),
    unsave: jest.fn(),
    findSavedPage: jest.fn(),
  };
  const postLookup = { findPostForInteraction: jest.fn() };
  const detail = jest.fn();
  beforeAll(async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'viewer', status: 'ACTIVE' }),
      },
    };
    const module = await Test.createTestingModule({
      controllers: [PostSaveController, PostsController],
      providers: [
        PostSaveService,
        PostVisibilityService,
        { provide: PostSaveRepository, useValue: repository },
        { provide: PrismaService, useValue: prisma },
        { provide: PostsRepository, useValue: postLookup },
        { provide: FollowsService, useValue: { isFollowing: jest.fn() } },
        { provide: PostsService, useValue: { findOne: detail } },
      ],
    }).compile();
    app = module.createNestApplication();
    // Native loading bypasses Jest's ESM restriction and the Session decorator mock.
    // Assertions describe installed module exports, never untrusted session payloads.
    const nativeRequire = process
      .getBuiltinModule('module')
      .createRequire(__filename);
    const { AuthGuard } = nativeRequire(
      '@thallesp/nestjs-better-auth',
    ) as typeof import('@thallesp/nestjs-better-auth');
    const { betterAuth } = nativeRequire(
      'better-auth',
    ) as typeof import('better-auth');
    const now = new Date();
    const session: UserSession = {
      user: {
        id: 'viewer',
        name: 'Viewer',
        email: 'viewer@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: 'session',
        userId: 'viewer',
        token: 'session-token',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60000),
        ipAddress: null,
        userAgent: null,
      },
    };
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'save-post-test-secret-at-least-32-characters',
    });
    jest
      .spyOn(auth.api, 'getSession')
      .mockImplementation((input) =>
        Promise.resolve(
          new Headers(input?.headers).get('cookie') ===
            'better-auth.session_token=valid'
            ? session
            : null,
        ),
      );
    const guard = new AuthGuard(new Reflector(), { auth });
    app.useGlobalGuards({
      async canActivate(context: ExecutionContext) {
        try {
          return await guard.canActivate(context);
        } catch (error: unknown) {
          // Native and Jest Nest modules have different HttpException constructors.
          if (
            typeof error === 'object' &&
            error !== null &&
            'getStatus' in error &&
            typeof error.getStatus === 'function'
          ) {
            const status: unknown = error.getStatus();
            if (typeof status === 'number')
              throw new HttpException('Authentication failed', status);
          }
          throw error;
        }
      },
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    repository.save.mockResolvedValue({ saved: true });
    repository.unsave.mockResolvedValue({ saved: false });
    repository.findSavedPage.mockResolvedValue([]);
    postLookup.findPostForInteraction.mockResolvedValue({
      id: 'post',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      authorId: 'author',
      deletedAt: null,
    });
  });
  afterAll(async () => {
    await app.close();
  });
  it('saves using only the session identity', async () => {
    await request(app.getHttpServer())
      .post('/posts/post/save?userId=victim')
      .set('Cookie', 'better-auth.session_token=valid')
      .send({ userId: 'victim' })
      .expect(201, { saved: true });
    expect(repository.save).toHaveBeenCalledWith('viewer', 'post');
  });
  it('unsaves without post visibility checks', async () => {
    await request(app.getHttpServer())
      .delete('/posts/post/save')
      .set('Cookie', 'better-auth.session_token=valid')
      .expect(200, { saved: false });
    expect(repository.unsave).toHaveBeenCalledWith('viewer', 'post');
    expect(postLookup.findPostForInteraction).not.toHaveBeenCalled();
  });
  it('resolves the static saved route and transforms pagination', async () => {
    const savedAt = new Date('2026-10-06T00:00:00.000Z');
    const cursor = encodeSavedPostCursor({ savedAt, postId: 'post' });
    await request(app.getHttpServer())
      .get('/posts/saved')
      .query({ limit: '2', cursor })
      .set('Cookie', 'better-auth.session_token=valid')
      .expect(200, { items: [], hasMore: false, nextCursor: null });
    expect(repository.findSavedPage).toHaveBeenCalledWith('viewer', 3, {
      savedAt,
      postId: 'post',
    });
    expect(detail).not.toHaveBeenCalled();
  });
  it.each(['0', '101', '1.5', 'abc'])(
    'rejects invalid limit %s',
    async (limit) => {
      await request(app.getHttpServer())
        .get('/posts/saved')
        .query({ limit })
        .set('Cookie', 'better-auth.session_token=valid')
        .expect(400);
      expect(repository.findSavedPage).not.toHaveBeenCalled();
    },
  );
  it.each(['!', '', 'a'.repeat(1001)])(
    'rejects invalid cursor %#',
    async (cursor) => {
      await request(app.getHttpServer())
        .get('/posts/saved')
        .query({ cursor })
        .set('Cookie', 'better-auth.session_token=valid')
        .expect(400);
      expect(repository.findSavedPage).not.toHaveBeenCalled();
    },
  );
  it.each(['post', 'delete', 'get'] as const)(
    'rejects unauthenticated %s',
    async (method) => {
      await request(app.getHttpServer())
        [method](method === 'get' ? '/posts/saved' : '/posts/post/save')
        .expect(401);
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.unsave).not.toHaveBeenCalled();
      expect(repository.findSavedPage).not.toHaveBeenCalled();
    },
  );
  it('rejects a forged session header and invalid cookie before post persistence', async () => {
    await request(app.getHttpServer())
      .post('/posts/post/save')
      .set('x-test-session', 'yes')
      .set('Cookie', 'better-auth.session_token=invalid')
      .send({ userId: 'viewer' })
      .expect(401);
    expect(postLookup.findPostForInteraction).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('rejects attempts to override the saved-list user scope', async () => {
    await request(app.getHttpServer())
      .get('/posts/saved?userId=victim')
      .set('Cookie', 'better-auth.session_token=valid')
      .expect(400);
    expect(repository.findSavedPage).not.toHaveBeenCalled();
  });
  it('documents actual routes, cookie auth, query constraints, and responses', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addCookieAuth('better-auth.session_token').build(),
    );
    const save = document.paths['/posts/{id}/save']?.post;
    const unsave = document.paths['/posts/{id}/save']?.delete;
    const list = document.paths['/posts/saved']?.get;
    expect(save?.security).toEqual([{ 'better-auth.session_token': [] }]);
    expect(save?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { properties: { saved: { enum: [true] } } },
        },
      },
    });
    expect(unsave?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { properties: { saved: { enum: [false] } } },
        },
      },
    });
    expect(save?.responses['401']).toBeDefined();
    expect(save?.responses['403']).toBeDefined();
    expect(save?.responses['404']).toBeDefined();
    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: { default: 20, minimum: 1, maximum: 100, type: 'integer' },
        }),
        expect.objectContaining({
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { maxLength: 1000, type: 'string' },
        }),
      ]),
    );
    expect(list?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['items', 'hasMore', 'nextCursor'],
            properties: {
              nextCursor: { nullable: true },
              items: {
                items: {
                  properties: {
                    savedAt: { format: 'date-time' },
                    savedByCurrentUser: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
