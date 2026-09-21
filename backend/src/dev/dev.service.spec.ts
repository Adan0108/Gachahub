jest.mock('../auth/auth', () => ({
  auth: { api: { signUpEmail: jest.fn(), signInEmail: jest.fn() } },
}));

import { InternalServerErrorException } from '@nestjs/common';
import { env } from '../config/env';
import { sessionStorage } from '../auth/session-storage';
import { DevService } from './dev.service';

/**
 * DevService can mint a session for any user id and mass-delete accounts -
 * its constructor guard against running outside development is the whole
 * defense-in-depth story once DevModule is ever accidentally registered
 * (app.module.ts). Must fail CLOSED: only 'development' is allowed, every
 * other value - including one that's unset, which env.ts now maps to
 * 'production' rather than defaulting to 'development' - is rejected.
 */
describe('DevService', () => {
  const originalNodeEnv = env.nodeEnv;

  afterEach(() => {
    env.nodeEnv = originalNodeEnv;
  });

  it('throws when nodeEnv is production', () => {
    env.nodeEnv = 'production';

    expect(() => new DevService({} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('throws for an unexpected nodeEnv value such as staging', () => {
    env.nodeEnv = 'staging';

    expect(() => new DevService({} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('does not throw when nodeEnv is development', () => {
    env.nodeEnv = 'development';

    expect(() => new DevService({} as never)).not.toThrow();
  });

  describe('deleting test users', () => {
    const makeService = () => {
      env.nodeEnv = 'development';
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ name: 'DevTest_1' }),
          delete: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        session: {
          findMany: jest.fn().mockResolvedValue([
            { userId: 'u1', token: 't1' },
            { userId: 'u1', token: 't2' },
            { userId: 'u2', token: 't3' },
          ]),
        },
      };
      return { prisma, service: new DevService(prisma as never) };
    };

    beforeEach(() => {
      for (const token of ['t1', 't2', 't3'])
        sessionStorage.set(token, 'login');
    });

    it('signs a deleted user out of the login cache too', async () => {
      const { service } = makeService();

      await service.deleteTestUser('u1');

      expect(sessionStorage.get('t1')).toBeNull();
      expect(sessionStorage.get('t2')).toBeNull();
    });

    it('does the same when deleting every test user', async () => {
      const { service } = makeService();

      await service.deleteAllTestUsers();

      expect(['t1', 't2', 't3'].map((t) => sessionStorage.get(t))).toEqual([
        null,
        null,
        null,
      ]);
    });
  });
});
