jest.mock('../auth/auth', () => ({ auth: {} }));
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
  OptionalAuth: () => () => undefined,
}));

import 'reflect-metadata';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { UsersController } from './users.controller';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { CheckUsernameQueryDto } from './dto/check-username-query.dto';

describe('UsersController.getMe', () => {
  it('reads a live row via the service instead of returning session.user directly', () => {
    const usersService = { getMe: jest.fn().mockReturnValue('r') };
    const controller = new UsersController({} as any, usersService as any);

    expect(
      controller.getMe({ user: { id: 'me' } } as unknown as UserSession),
    ).toBe('r');
    expect(usersService.getMe).toHaveBeenCalledWith('me');
  });
});

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

describe('UsersController.checkUsernameAvailable', () => {
  it('is declared before the :userId route so it is not swallowed', () => {
    const proto = UsersController.prototype as unknown as Record<
      string,
      object
    >;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata('path', proto[name]) as string);

    expect(paths.indexOf('username-available')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('username-available')).toBeLessThan(
      paths.indexOf(':userId'),
    );
  });

  it('validates the query and wraps the service result', async () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      UsersController.prototype,
      'checkUsernameAvailable',
    ) as unknown[];
    expect(paramTypes[0]).toBe(CheckUsernameQueryDto);

    const usersService = {
      isUsernameAvailable: jest.fn().mockResolvedValue(true),
    };
    const controller = new UsersController({} as any, usersService as any);
    const query = new CheckUsernameQueryDto();
    query.username = 'Mado-123';

    await expect(controller.checkUsernameAvailable(query)).resolves.toEqual({
      available: true,
    });
    expect(usersService.isUsernameAvailable).toHaveBeenCalledWith('Mado-123');
  });
});

describe('UsersController.completeOnboarding', () => {
  it('validates the body and delegates with the session user', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      UsersController.prototype,
      'completeOnboarding',
    ) as unknown[];
    expect(paramTypes[1]).toBe(CompleteOnboardingDto);

    const usersService = {
      completeOnboarding: jest.fn().mockReturnValue('r'),
    };
    const controller = new UsersController({} as any, usersService as any);
    const dto = new CompleteOnboardingDto();

    expect(
      controller.completeOnboarding(
        { user: { id: 'me' } } as unknown as UserSession,
        dto,
      ),
    ).toBe('r');
    expect(usersService.completeOnboarding).toHaveBeenCalledWith('me', dto);
  });
});
