import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { AdminGuard } from './admin.guard';

const createContext = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  let guard: AdminGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AdminGuard(prisma as any);
  });

  it('throws when request has no authenticated user', async () => {
    await expect(guard.canActivate(createContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when authenticated user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when user account is not active', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      status: 'SUSPENDED',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when user is not admin', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows active admin user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'admin-1',
          },
        }),
      ),
    ).resolves.toBe(true);
  });
});
