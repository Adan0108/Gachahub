jest.mock('../auth/auth', () => ({
  auth: { api: { signUpEmail: jest.fn(), signInEmail: jest.fn() } },
}));

import { InternalServerErrorException } from '@nestjs/common';
import { env } from '../config/env';
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

    expect(() => new DevService({} as never, {} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('throws for an unexpected nodeEnv value such as staging', () => {
    env.nodeEnv = 'staging';

    expect(() => new DevService({} as never, {} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('does not throw when nodeEnv is development', () => {
    env.nodeEnv = 'development';

    expect(() => new DevService({} as never, {} as never)).not.toThrow();
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
            { id: 's1', token: 't1' },
            { id: 's2', token: 't2' },
          ]),
        },
      };
      const terminator = { end: jest.fn() };
      return {
        prisma,
        terminator,
        service: new DevService(prisma as never, terminator as never),
      };
    };

    it('ends the logins of a deleted user properly, before removing them', async () => {
      const { service, terminator, prisma } = makeService();

      await service.deleteTestUser('u1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { user: { id: 'u1' } },
        select: { id: true, token: true },
      });
      expect(terminator.end).toHaveBeenCalledWith([
        { id: 's1', token: 't1' },
        { id: 's2', token: 't2' },
      ]);
    });

    it('does the same when deleting every test user', async () => {
      const { service, terminator } = makeService();

      await service.deleteAllTestUsers();

      expect(terminator.end).toHaveBeenCalledTimes(1);
    });
  });
});
