jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    Session: () =>
      common.createParamDecorator(
        (
          _data: unknown,
          context: import('@nestjs/common').ExecutionContext,
        ) => {
          const request = context
            .switchToHttp()
            .getRequest<{ headers: Record<string, string> }>();
          return request.headers['x-test-session']
            ? { user: { id: 'session-user' } }
            : undefined;
        },
      )(),
  };
});
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import type { PrismaService } from '../prisma/prisma.service';
import type { GameMembershipRepository } from './game-membership.repository';
import { GameMembershipController } from './game-membership.controller';
import { GameMembershipService } from './game-membership.service';

describe('GameMembershipController HTTP contract', () => {
  let app: INestApplication<Server>;
  const repository = {
    findGameBySlug: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    status: jest.fn(),
    list: jest.fn(),
  };
  beforeAll(async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-user',
          status: 'ACTIVE',
          role: 'USER',
        }),
      },
    };
    const service = new GameMembershipService(
      repository as unknown as GameMembershipRepository,
      prisma as unknown as PrismaService,
    );
    const module = await Test.createTestingModule({
      controllers: [GameMembershipController],
      providers: [{ provide: GameMembershipService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findGameBySlug.mockResolvedValue({
      id: 'game',
      status: 'ACTIVE',
    });
    repository.join.mockResolvedValue({ joined: true });
    repository.leave.mockResolvedValue({ joined: false });
    repository.status.mockResolvedValue({ joined: true });
    repository.list.mockResolvedValue([]);
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects unauthenticated join with 401', async () => {
    await request(app.getHttpServer()).post('/games/wuwa/join').expect(401);
    expect(repository.join).not.toHaveBeenCalled();
  });
  it('joins as session user, ignoring body/query identities and elevated role', async () => {
    await request(app.getHttpServer())
      .post('/games/wuwa/join?userId=victim')
      .set('x-test-session', 'yes')
      .send({ userId: 'victim', role: 'ADMIN' })
      .expect(201, { joined: true });
    expect(repository.join).toHaveBeenCalledWith('game', 'session-user');
  });
  it('leaves as session user', async () => {
    await request(app.getHttpServer())
      .delete('/games/wuwa/join')
      .set('x-test-session', 'yes')
      .expect(200, { joined: false });
    expect(repository.leave).toHaveBeenCalledWith('game', 'session-user');
  });
  it('returns minimal status', async () => {
    await request(app.getHttpServer())
      .get('/games/wuwa/join-status')
      .set('x-test-session', 'yes')
      .expect(200, { joined: true });
    expect(repository.status).toHaveBeenCalledWith('game', 'session-user');
  });
  it('lists joined communities using session identity', async () => {
    await request(app.getHttpServer())
      .get('/games/joined')
      .set('x-test-session', 'yes')
      .expect(200, { items: [] });
    expect(repository.list).toHaveBeenCalledWith('session-user');
  });
});
