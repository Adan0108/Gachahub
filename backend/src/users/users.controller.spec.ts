jest.mock('../auth/auth', () => ({ auth: {} }));
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
  OptionalAuth: () => () => undefined,
}));

import 'reflect-metadata';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { UsersController } from './users.controller';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';

describe('UsersController.search', () => {
  it('is declared before the :userId route so it is not swallowed', () => {
    const proto = UsersController.prototype as unknown as Record<
      string,
      object
    >;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata('path', proto[name]) as string);

    expect(paths.indexOf('search')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('search')).toBeLessThan(paths.indexOf(':userId'));
  });

  it('validates the query and delegates with the session user', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      UsersController.prototype,
      'search',
    ) as unknown[];
    expect(paramTypes[1]).toBe(SearchUsersQueryDto);

    const usersService = { searchForPicker: jest.fn().mockReturnValue('r') };
    const controller = new UsersController({} as any, usersService as any);
    const query = new SearchUsersQueryDto();

    expect(
      controller.search(
        { user: { id: 'me' } } as unknown as UserSession,
        query,
      ),
    ).toBe('r');
    expect(usersService.searchForPicker).toHaveBeenCalledWith('me', query);
  });
});
