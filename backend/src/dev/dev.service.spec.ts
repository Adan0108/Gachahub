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
});
