import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { PlatformModeratorGuard } from './platform-moderator.guard';

const createContext = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('PlatformModeratorGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let guard: PlatformModeratorGuard;
  const context = createContext({ user: { id: 'user-1' } });

  beforeEach(() => {
    jest.resetAllMocks();
    guard = new PlatformModeratorGuard(prisma as unknown as PrismaService);
  });

  it.each([UserRole.PLATFORM_MODERATOR, UserRole.ADMIN])(
    'allows active %s',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role,
        status: UserStatus.ACTIVE,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { id: true, role: true, status: true },
      });
    },
  );

  it('denies active USER', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('PlatformModerator permission required'),
    );
  });

  it.each([{}, { user: {} }])(
    'denies a missing authenticated id (%j)',
    async (request) => {
      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        new UnauthorizedException('Authentication required'),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('denies a missing database user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('User not found'),
    );
  });

  it.each([UserStatus.SUSPENDED, UserStatus.BANNED, UserStatus.DELETED])(
    'denies a %s account even with moderation capability',
    async (status) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: UserRole.PLATFORM_MODERATOR,
        status,
      });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new ForbiddenException('User account is not active'),
      );
    },
  );

  it.each([
    [UserRole.USER, UserRole.ADMIN, false],
    [UserRole.PLATFORM_MODERATOR, UserRole.USER, true],
  ])(
    'uses database role %s despite session role %s',
    async (role, sessionRole, allowed) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role,
        status: UserStatus.ACTIVE,
      });
      const result = guard.canActivate(
        createContext({
          user: { id: 'user-1', role: sessionRole },
        }),
      );
      if (allowed) {
        await expect(result).resolves.toBe(true);
      } else {
        await expect(result).rejects.toThrow(ForbiddenException);
      }
    },
  );
});
