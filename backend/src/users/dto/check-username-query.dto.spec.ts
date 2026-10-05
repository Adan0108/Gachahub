import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { USERNAME_HINT } from './complete-onboarding.dto';
import { CheckUsernameQueryDto } from './check-username-query.dto';

const check = (username: string) =>
  validate(plainToInstance(CheckUsernameQueryDto, { username }));

describe('CheckUsernameQueryDto', () => {
  it('accepts a valid handle', async () => {
    expect(await check('Bob-12345')).toHaveLength(0);
  });

  it.each(['-bob', 'a--b', 'bob_', 'ab'])(
    'rejects %s and explains every rule via the shared hint',
    async (username) => {
      const [error] = await check(username);

      expect(error.constraints?.matches).toBe(
        `username must be ${USERNAME_HINT}`,
      );
    },
  );
});
